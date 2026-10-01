import { addDays, type Depot, weekdayIndex } from '@wayflow/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/drizzle.module.js';
import {
  appSettings,
  attachments,
  calendarDays,
  decisions,
  exceptions,
  loadFlags,
  notifications,
  orders,
  outlets,
  planVersions,
  plans,
  problemReports,
  receipts,
  stops,
  syncActions,
  trips,
  users,
  vehicleDays,
  vehicles,
} from '../db/schema.js';
import { hashPassword } from '../auth/passwords.js';
import { loadCsv, num, oneOf, rng, SeedError } from './csv.js';
import type { OutletHistory } from './reference.js';

/** The demo run (matches the Designathon frames): planning on Tue 19 May for the Wed 20 May run. */
export const DEMO_RUN_DATE = '2026-05-20';
export const DEMO_STORE_OUTLET = 'OUT105';
const SEED = 20261004;

/** Named accounts from the Figma sign-in frame; every other vehicle and outlet gets a generic account. */
export const NAMED_USERS = [
  { email: 'kasun@waypoint.lk', name: 'Kasun P.', role: 'dispatcher' as const },
  { email: 'kandy-dock@waypoint.lk', name: 'Nimal S.', role: 'loader' as const, depot: 'Kandy' as const },
  { email: 'peliyagoda-dock@waypoint.lk', name: 'Peliyagoda dock', role: 'loader' as const, depot: 'Peliyagoda' as const },
  { email: 'sampath@waypoint.lk', name: 'Sampath R.', role: 'driver' as const, vehicleId: 'VEH040' },
  { email: 'out105@waypoint.lk', name: 'Dilani W.', role: 'store_manager' as const, outletId: DEMO_STORE_OUTLET },
];

export async function seedUsers(db: Db, password: string, log: (m: string) => void): Promise<number> {
  const existing = new Set((await db.select({ email: users.email }).from(users)).map((u) => u.email));
  const vehicleIds = (await db.select({ id: vehicles.vehicleId }).from(vehicles)).map((v) => v.id);
  const outletIds = (await db.select({ id: outlets.outletId }).from(outlets)).map((o) => o.id);
  // Each account is hashed separately so every hash has its own random salt (SEC-02).
  const wanted: (Omit<typeof users.$inferInsert, 'passwordHash'>)[] = [];
  for (const u of NAMED_USERS) wanted.push({ ...u });
  const namedVehicles = new Set(NAMED_USERS.map((u) => ('vehicleId' in u ? u.vehicleId : undefined)));
  const namedOutlets = new Set(NAMED_USERS.map((u) => ('outletId' in u ? u.outletId : undefined)));
  for (const v of vehicleIds) {
    if (namedVehicles.has(v)) continue;
    wanted.push({ email: `driver.${v.toLowerCase()}@waypoint.lk`, name: `Driver ${v}`, role: 'driver', vehicleId: v });
  }
  for (const o of outletIds) {
    if (namedOutlets.has(o)) continue;
    wanted.push({ email: `${o.toLowerCase()}@waypoint.lk`, name: `${o} manager`, role: 'store_manager', outletId: o });
  }
  const fresh = wanted.filter((u) => !existing.has(u.email));
  const hashed: (typeof users.$inferInsert)[] = [];
  for (let i = 0; i < fresh.length; i += 8) {
    const batch = fresh.slice(i, i + 8);
    const hashes = await Promise.all(batch.map(() => hashPassword(password)));
    batch.forEach((u, j) => hashed.push({ ...u, passwordHash: hashes[j]! }));
  }
  for (let i = 0; i < hashed.length; i += 100) await db.insert(users).values(hashed.slice(i, i + 100));
  log(`  users: ${fresh.length} created, ${existing.size} already present`);
  return fresh.length;
}

type OrderInsert = typeof orders.$inferInsert;

/** Wipe all transactional data (orders, plans, field events, notifications). Reference data and users stay. */
export async function clearTransactional(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(attachments);
    await tx.delete(notifications);
    await tx.delete(syncActions);
    await tx.delete(exceptions);
    await tx.delete(receipts);
    await tx.delete(problemReports);
    await tx.delete(loadFlags);
    await tx.delete(decisions);
    await tx.delete(stops);
    await tx.delete(trips);
    await tx.delete(planVersions);
    await tx.delete(plans);
    await tx.delete(orders);
    await tx.delete(vehicleDays);
    await tx.delete(appSettings);
  });
}

interface DemoReport {
  orders: number;
  byDepot: Record<string, { orders: number; chilled: number; kg: number; m3: number }>;
}

/**
 * Demo orders:
 *  - Peliyagoda, 20 May: the 85 real orders of Task 2B scenario S1 (over-capacity day, 10 vehicles in the workshop).
 *  - Kandy, 14–20 May: synthetic orders (source = synthetic_seed) generated from each outlet's own
 *    order-size and frequency history in deliveries_train.csv. 19 May has two deferrals so the
 *    "skipped last run" priority is visible on the demo day.
 */
export async function seedDemo(db: Db, dataDir: string, history: OutletHistory, log: (m: string) => void): Promise<DemoReport> {
  const allOutlets = await db.select().from(outlets);
  const outletById = new Map(allOutlets.map((o) => [o.outletId, o]));
  const fleet = await db.select().from(vehicles);
  const report: DemoReport = { orders: 0, byDepot: {} };
  const rows: OrderInsert[] = [];

  // ---- Peliyagoda: Task 2B scenario S1 ----
  const s1 = loadCsv(
    dataDir,
    'Test Data/task2b_peak_day_scenarios.csv',
    ['scenario', 'order_ref', 'outlet_id', 'brand', 'district', 'depot', 'dock_type', 'parking_constraint', 'mall_window', 'window_open_time', 'window_close_time', 'temp_requirement', 'order_units', 'order_weight_kg', 'order_volume_m3', 'deferred_yesterday', 'days_since_last_served'],
  );
  for (const r of s1) {
    const outlet = outletById.get(r.outlet_id!);
    if (!outlet) throw new SeedError(`S1 order ${r.order_ref} references unknown outlet ${r.outlet_id}`);
    if (outlet.brand !== r.brand || outlet.depot !== r.depot) throw new SeedError(`S1 order ${r.order_ref} disagrees with outlets.csv`);
    rows.push({
      ref: r.order_ref!,
      outletId: outlet.outletId,
      brand: outlet.brand,
      temp: oneOf(r.temp_requirement, ['ambient', 'chilled'] as const, 'temp_requirement'),
      units: num(r.order_units, 'order_units', { min: 1 }),
      weightKg: num(r.order_weight_kg, 'order_weight_kg', { min: 0.01 }),
      volumeM3: num(r.order_volume_m3, 'order_volume_m3', { min: 0.001 }),
      runDate: DEMO_RUN_DATE,
      status: 'confirmed',
      source: 'task2b_s1',
      deferredYesterday: r.deferred_yesterday === '1',
      daysSinceLastServed: num(r.days_since_last_served, 'days_since_last_served', { min: 0 }),
      confirmedAt: new Date('2026-05-19T09:00:00+05:30'),
    });
  }
  const fleetRows = loadCsv(dataDir, 'Test Data/task2b_peak_day_fleet.csv', ['scenario', 'vehicle_id', 'status']);
  const days: (typeof vehicleDays.$inferInsert)[] = fleetRows.map((r) => ({
    vehicleId: r.vehicle_id!,
    date: DEMO_RUN_DATE,
    status: oneOf(r.status, ['available', 'in_workshop'] as const, 'status'),
    note: 'Task 2B scenario S1 fleet status',
  }));
  // Kandy: one refrigerated van in the workshop (the Designathon story: VEH058).
  for (const v of fleet.filter((x) => x.depot === 'Kandy')) {
    days.push({ vehicleId: v.vehicleId, date: DEMO_RUN_DATE, status: v.vehicleId === 'VEH058' ? 'in_workshop' : 'available', note: v.vehicleId === 'VEH058' ? 'Scheduled service' : null });
  }

  // ---- Kandy: synthetic history (5 operating days before) and demo day ----
  const calendar = new Map(
    (await db.select().from(calendarDays).where(inArray(calendarDays.date, Array.from({ length: 10 }, (_, i) => addDays(DEMO_RUN_DATE, -9 + i))))).map((c) => [c.date, c]),
  );
  const historyDates: string[] = [];
  for (let d = addDays(DEMO_RUN_DATE, -1); historyDates.length < 5; d = addDays(d, -1)) {
    if (calendar.get(d)?.isOperating) historyDates.unshift(d);
  }
  const kandyOutlets = allOutlets.filter((o) => o.depot === 'Kandy').sort((a, b) => a.outletId.localeCompare(b.outletId));
  const smallest = (depot: Depot, chilled: boolean, vanOnly: boolean) =>
    Math.min(
      ...fleet
        .filter((v) => v.depot === depot && (!chilled || v.temp === 'reefer') && (!vanOnly || v.type === 'van'))
        .map((v) => v.volumeCapM3),
    );
  let seq = 1_000_001;
  const random = rng(SEED);
  const lastServed = new Map<string, string>();
  const deferredOn = new Map<string, string>();
  const historyRows: OrderInsert[] = [];

  const generate = (date: string): OrderInsert[] => {
    const out: OrderInsert[] = [];
    const ramp = calendar.get(date)?.festivalRamp ?? 0;
    for (const o of kandyOutlets) {
      for (const temp of ['ambient', 'chilled'] as const) {
        const prof = history.perOutletTemp.get(`${o.outletId}|${temp}`);
        if (!prof) continue;
        const freq = history.frequency.get(`${o.outletId}|${temp}`) ?? 0;
        let include: boolean;
        if (o.brand === 'Fresh') include = temp === 'ambient' ? true : random() < Math.min(1, freq / Math.max(0.01, history.frequency.get(`${o.outletId}|ambient`) ?? 1));
        else if (o.brand === 'Style') include = history.weekday.get(o.outletId) === weekdayIndex(date);
        else include = random() < Math.min(1, freq * 1.6);
        const jitter = 0.85 + random() * 0.3;
        if (!include) continue;
        const boost = o.brand === 'Style' ? 1 + 0.5 * ramp : 1 + 0.15 * ramp;
        const units = Math.max(1, Math.round(prof.units * jitter * boost));
        let volume = units * prof.m3PerUnit;
        const cap = smallest('Kandy', temp === 'chilled', o.parkingConstraint === 'van_only') * 0.9;
        const scale = volume > cap ? cap / volume : 1;
        const finalUnits = Math.max(1, Math.floor(units * scale));
        volume = finalUnits * prof.m3PerUnit;
        out.push({
          ref: `ORD${seq++}`,
          outletId: o.outletId,
          brand: o.brand,
          temp,
          units: finalUnits,
          weightKg: Math.round(finalUnits * prof.kgPerUnit * 10) / 10,
          volumeM3: Math.round(volume * 100) / 100,
          runDate: date,
          status: 'received',
          source: 'synthetic_seed',
          confirmedAt: new Date(`${addDays(date, -1)}T11:00:00+05:30`),
        });
      }
    }
    return out;
  };

  for (const date of historyDates) {
    const day = generate(date);
    // Last history day: two chilled van-only orders could not be served (refrigerated van short).
    if (date === historyDates[historyDates.length - 1]) {
      const vanChilled = day.filter((r) => r.temp === 'chilled' && outletById.get(r.outletId)?.parkingConstraint === 'van_only');
      for (const r of vanChilled.slice(-2)) {
        r.status = 'deferred';
        deferredOn.set(r.outletId, date);
      }
    }
    for (const r of day) if (r.status === 'received') lastServed.set(r.outletId, date);
    historyRows.push(...day);
  }

  const demoDay = generate(DEMO_RUN_DATE).filter((r) => r.outletId !== DEMO_STORE_OUTLET);
  for (const r of demoDay) {
    r.status = 'confirmed';
    r.deferredYesterday = deferredOn.has(r.outletId);
    const last = lastServed.get(r.outletId);
    r.daysSinceLastServed = last ? Math.round((Date.parse(DEMO_RUN_DATE) - Date.parse(last)) / 86_400_000) : 7;
  }
  rows.push(...demoDay);

  await db.transaction(async (tx) => {
    for (let i = 0; i < historyRows.length; i += 200) await tx.insert(orders).values(historyRows.slice(i, i + 200));
    for (let i = 0; i < rows.length; i += 200) await tx.insert(orders).values(rows.slice(i, i + 200));
    await tx.insert(vehicleDays).values(days).onConflictDoNothing();

    // History plans (closed) record why the 19 May orders were deferred.
    const deferredHistory = historyRows.filter((r) => r.status === 'deferred');
    if (deferredHistory.length) {
      const [plan] = await tx
        .insert(plans)
        .values({ runDate: historyDates[historyDates.length - 1]!, depot: 'Kandy', status: 'closed', engine: 'synthetic_history', publishedVersion: 1 })
        .returning();
      const ids = await tx.select({ id: orders.id, ref: orders.ref }).from(orders).where(inArray(orders.ref, deferredHistory.map((r) => r.ref)));
      await tx.insert(decisions).values(
        ids.map((o) => ({
          planId: plan!.id,
          orderId: o.id,
          decision: 'deferred' as const,
          reasonCode: 'NO_REEFER_CAPACITY' as const,
          deferralClass: 'unavoidable' as const,
          explanation: 'Synthetic history: the only refrigerated van able to reach van-only outlets was full.',
          storeReason: 'No refrigerated van capacity left (van-only outlet)',
          notifiedAt: new Date(),
        })),
      );
    }
  });

  for (const r of rows) {
    const depot = outletById.get(r.outletId)!.depot;
    const agg = (report.byDepot[depot] ??= { orders: 0, chilled: 0, kg: 0, m3: 0 });
    agg.orders++;
    if (r.temp === 'chilled') agg.chilled++;
    agg.kg += r.weightKg;
    agg.m3 += r.volumeM3;
  }
  report.orders = rows.length;
  log(`  orders: ${rows.length} for ${DEMO_RUN_DATE} (${s1.length} from scenario S1, ${demoDay.length} synthetic Kandy) + ${historyRows.length} synthetic history`);
  return report;
}

/** Capacity vs demand per depot × temperature class, printed after seeding (specs/10 §3). */
export async function capacityReport(db: Db, log: (m: string) => void): Promise<void> {
  const fleet = await db.select().from(vehicles);
  const status = new Map((await db.select().from(vehicleDays).where(eq(vehicleDays.date, DEMO_RUN_DATE))).map((v) => [v.vehicleId, v.status]));
  const demand = await db
    .select({
      depot: outlets.depot,
      temp: orders.temp,
      n: sql<number>`count(*)::int`,
      kg: sql<number>`sum(${orders.weightKg})::float`,
      m3: sql<number>`sum(${orders.volumeM3})::float`,
    })
    .from(orders)
    .innerJoin(outlets, eq(outlets.outletId, orders.outletId))
    .where(eq(orders.runDate, DEMO_RUN_DATE))
    .groupBy(outlets.depot, orders.temp);
  log(`  capacity vs demand for ${DEMO_RUN_DATE} (2 trips per available vehicle):`);
  for (const depot of ['Peliyagoda', 'Kandy'] as const) {
    const avail = fleet.filter((v) => v.depot === depot && status.get(v.vehicleId) !== 'in_workshop');
    const reefer = avail.filter((v) => v.temp === 'reefer');
    const cap = (vs: typeof fleet) => ({ kg: vs.reduce((a, v) => a + v.weightCapKg * 2, 0), m3: vs.reduce((a, v) => a + v.volumeCapM3 * 2, 0) });
    const all = cap(avail);
    const rc = cap(reefer);
    const d = demand.filter((x) => x.depot === depot);
    const chilled = d.find((x) => x.temp === 'chilled');
    const total = d.reduce((a, x) => ({ kg: a.kg + x.kg, m3: a.m3 + x.m3, n: a.n + x.n }), { kg: 0, m3: 0, n: 0 });
    log(
      `    ${depot.padEnd(10)} ${avail.length} vehicles (${reefer.length} reefer) · all goods ${total.n} orders ${Math.round(total.m3)} m³ vs ${Math.round(all.m3)} m³ (${Math.round((100 * total.m3) / all.m3)}%) · chilled ${chilled?.n ?? 0} orders ${Math.round(chilled?.m3 ?? 0)} m³ vs reefer ${Math.round(rc.m3)} m³ (${Math.round((100 * (chilled?.m3 ?? 0)) / Math.max(1, rc.m3))}%)`,
    );
  }
}
