import { createHash } from 'node:crypto';
import { BRANDS, DEPOTS, DOCK_TYPES, hhmmToMin, PARKING_CONSTRAINTS, TEMP_REQUIREMENTS, VEHICLE_TEMPS, VEHICLE_TYPES } from '@wayflow/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/drizzle.module.js';
import {
  calendarDays,
  districtTravel,
  outlets,
  roadConditions,
  serviceAllowances,
  trafficSpeeds,
  unitProfiles,
  vehicles,
} from '../db/schema.js';
import { flag, loadCsv, num, oneOf, SeedError } from './csv.js';

const G = 'General Data';

/** Expected row counts from specs/10 §1. */
export const EXPECTED = {
  outlets: 120,
  vehicles: 60,
  calendar: 910,
  districtTravel: 12,
  serviceAllowance: 9,
  trafficSpeed: 576,
  roadConditions: 10_920,
} as const;

async function chunked<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

export interface OutletHistory {
  /** Median units, kg/unit and m³/unit per outlet × temperature from deliveries_train.csv. */
  perOutletTemp: Map<string, { units: number; kgPerUnit: number; m3PerUnit: number; days: number }>;
  /** Share of operating days an outlet ordered, per temperature. */
  frequency: Map<string, number>;
  /** Most common weekday (0 = Mon) per outlet, for weekly Style orders. */
  weekday: Map<string, number>;
  totalDays: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

export async function seedReference(db: Db, dataDir: string, log: (m: string) => void): Promise<{ history: OutletHistory; checksum: string }> {
  const hash = createHash('sha256');

  // outlets.csv
  const outletRows = loadCsv(dataDir, `${G}/outlets.csv`, ['outlet_id', 'brand', 'district', 'depot', 'dock_type', 'parking_constraint', 'mall_window', 'window_open_time', 'window_close_time'], EXPECTED.outlets);
  const parsedOutlets = outletRows.map((r) => {
    let mallOpen: number | null = null;
    let mallClose: number | null = null;
    if (r.mall_window) {
      const [a, b] = r.mall_window.split('-');
      if (!a || !b) throw new SeedError(`Bad mall_window "${r.mall_window}" for ${r.outlet_id}`);
      mallOpen = hhmmToMin(a);
      mallClose = hhmmToMin(b);
    }
    if (!/^OUT\d{3}$/.test(r.outlet_id!)) throw new SeedError(`Bad outlet_id ${r.outlet_id}`);
    return {
      outletId: r.outlet_id!,
      brand: oneOf(r.brand, BRANDS, 'brand'),
      district: r.district!,
      depot: oneOf(r.depot, DEPOTS, 'depot'),
      dockType: oneOf(r.dock_type, DOCK_TYPES, 'dock_type'),
      parkingConstraint: oneOf(r.parking_constraint, PARKING_CONSTRAINTS, 'parking_constraint'),
      mallOpenMin: mallOpen,
      mallCloseMin: mallClose,
      windowOpenMin: hhmmToMin(r.window_open_time!),
      windowCloseMin: hhmmToMin(r.window_close_time!),
      name: '',
    };
  });
  // Display names: position of the outlet inside its brand + district, ordered by outlet id.
  const counters = new Map<string, number>();
  for (const o of [...parsedOutlets].sort((a, b) => a.outletId.localeCompare(b.outletId))) {
    const k = `${o.brand}|${o.district}`;
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);
    o.name = `Waypoint ${o.brand} ${o.district} ${n}`;
  }
  await db.insert(outlets).values(parsedOutlets).onConflictDoUpdate({
    target: outlets.outletId,
    set: {
      brand: sql`excluded.brand`,
      district: sql`excluded.district`,
      depot: sql`excluded.depot`,
      dockType: sql`excluded.dock_type`,
      parkingConstraint: sql`excluded.parking_constraint`,
      mallOpenMin: sql`excluded.mall_open_min`,
      mallCloseMin: sql`excluded.mall_close_min`,
      windowOpenMin: sql`excluded.window_open_min`,
      windowCloseMin: sql`excluded.window_close_min`,
      name: sql`excluded.name`,
    },
  });
  hash.update(JSON.stringify(parsedOutlets));

  // vehicles.csv
  const vehicleRows = loadCsv(dataDir, `${G}/vehicles.csv`, ['vehicle_id', 'type', 'temp', 'weight_cap_kg', 'volume_cap_m3', 'fuel_type', 'km_per_l', 'weekly_fuel_quota_l', 'depot'], EXPECTED.vehicles);
  const parsedVehicles = vehicleRows.map((r) => ({
    vehicleId: r.vehicle_id!,
    type: oneOf(r.type, VEHICLE_TYPES, 'type'),
    temp: oneOf(r.temp, VEHICLE_TEMPS, 'temp'),
    weightCapKg: num(r.weight_cap_kg, 'weight_cap_kg', { min: 1 }),
    volumeCapM3: num(r.volume_cap_m3, 'volume_cap_m3', { min: 0.1 }),
    fuelType: r.fuel_type!,
    kmPerL: num(r.km_per_l, 'km_per_l', { min: 0.1 }),
    weeklyFuelQuotaL: num(r.weekly_fuel_quota_l, 'weekly_fuel_quota_l', { min: 0 }),
    depot: oneOf(r.depot, DEPOTS, 'depot'),
  }));
  await db.insert(vehicles).values(parsedVehicles).onConflictDoUpdate({
    target: vehicles.vehicleId,
    set: {
      type: sql`excluded.type`,
      temp: sql`excluded.temp`,
      weightCapKg: sql`excluded.weight_cap_kg`,
      volumeCapM3: sql`excluded.volume_cap_m3`,
      fuelType: sql`excluded.fuel_type`,
      kmPerL: sql`excluded.km_per_l`,
      weeklyFuelQuotaL: sql`excluded.weekly_fuel_quota_l`,
      depot: sql`excluded.depot`,
    },
  });
  hash.update(JSON.stringify(parsedVehicles));

  // calendar.csv
  const calRows = loadCsv(dataDir, `${G}/calendar.csv`, ['date', 'dow', 'dow_name', 'is_weekend', 'iso_year', 'iso_week', 'is_payday', 'festival', 'festival_ramp', 'is_holiday', 'monsoon', 'is_operating'], EXPECTED.calendar);
  const parsedCal = calRows.map((r) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date!)) throw new SeedError(`Bad calendar date ${r.date}`);
    return {
      date: r.date!,
      dow: num(r.dow, 'dow', { min: 0, max: 6 }),
      dowName: r.dow_name!,
      isWeekend: flag(r.is_weekend, 'is_weekend'),
      isoYear: num(r.iso_year, 'iso_year'),
      isoWeek: num(r.iso_week, 'iso_week', { min: 1, max: 53 }),
      isPayday: flag(r.is_payday, 'is_payday'),
      festival: r.festival || null,
      festivalRamp: num(r.festival_ramp, 'festival_ramp', { min: 0, max: 1 }),
      isHoliday: flag(r.is_holiday, 'is_holiday'),
      monsoon: flag(r.monsoon, 'monsoon'),
      isOperating: flag(r.is_operating, 'is_operating'),
    };
  });
  await chunked(parsedCal, 500, (c) => db.insert(calendarDays).values(c).onConflictDoNothing());
  hash.update(JSON.stringify(parsedCal));

  // district_travel.csv
  const travelRows = loadCsv(dataDir, `${G}/district_travel.csv`, ['district', 'depot', 'road_class', 'free_flow_kmh', 'depot_to_district_km', 'depot_to_district_freeflow_min', 'inter_stop_km', 'inter_stop_freeflow_min'], EXPECTED.districtTravel);
  const parsedTravel = travelRows.map((r) => ({
    district: r.district!,
    depot: oneOf(r.depot, DEPOTS, 'depot'),
    roadClass: r.road_class!,
    freeFlowKmh: num(r.free_flow_kmh, 'free_flow_kmh', { min: 1 }),
    depotToDistrictKm: num(r.depot_to_district_km, 'depot_to_district_km', { min: 0 }),
    depotToDistrictFreeflowMin: num(r.depot_to_district_freeflow_min, 'depot_to_district_freeflow_min', { min: 0 }),
    interStopKm: num(r.inter_stop_km, 'inter_stop_km', { min: 0 }),
    interStopFreeflowMin: num(r.inter_stop_freeflow_min, 'inter_stop_freeflow_min', { min: 0 }),
  }));
  await db.insert(districtTravel).values(parsedTravel).onConflictDoNothing();
  hash.update(JSON.stringify(parsedTravel));

  // service_allowance.csv — never hard-coded
  const allowRows = loadCsv(dataDir, `${G}/service_allowance.csv`, ['brand', 'dock_type', 'service_allowance_min'], EXPECTED.serviceAllowance);
  const parsedAllow = allowRows.map((r) => ({
    brand: oneOf(r.brand, BRANDS, 'brand'),
    dockType: oneOf(r.dock_type, DOCK_TYPES, 'dock_type'),
    minutes: num(r.service_allowance_min, 'service_allowance_min', { min: 1 }),
  }));
  await db.insert(serviceAllowances).values(parsedAllow).onConflictDoNothing();
  hash.update(JSON.stringify(parsedAllow));

  // traffic_speed.csv
  const speedRows = loadCsv(dataDir, `${G}/traffic_speed.csv`, ['district', 'hour', 'monsoon', 'speed_index'], EXPECTED.trafficSpeed);
  const parsedSpeed = speedRows.map((r) => ({
    district: r.district!,
    hour: num(r.hour, 'hour', { min: 0, max: 23 }),
    monsoon: flag(r.monsoon, 'monsoon'),
    speedIndex: num(r.speed_index, 'speed_index', { min: 1 }),
  }));
  await chunked(parsedSpeed, 600, (c) => db.insert(trafficSpeeds).values(c).onConflictDoNothing());
  hash.update(JSON.stringify(parsedSpeed));

  // road_conditions.csv
  const roadRows = loadCsv(dataDir, `${G}/road_conditions.csv`, ['district', 'date', 'disruption_index'], EXPECTED.roadConditions);
  const parsedRoad = roadRows.map((r) => ({
    district: r.district!,
    date: r.date!,
    disruptionIndex: num(r.disruption_index, 'disruption_index', { min: 0 }),
  }));
  await chunked(parsedRoad, 2000, (c) => db.insert(roadConditions).values(c).onConflictDoNothing());
  hash.update(JSON.stringify(parsedRoad));

  const { history, profiles, rows } = readHistory(dataDir);
  await db
    .insert(unitProfiles)
    .values(profiles)
    .onConflictDoUpdate({
      target: [unitProfiles.brand, unitProfiles.temp],
      set: { kgPerUnit: sql`excluded.kg_per_unit`, m3PerUnit: sql`excluded.m3_per_unit`, sampleSize: sql`excluded.sample_size` },
    });
  log(`  history: ${rows} training deliveries summarised into ${history.perOutletTemp.size} outlet × temperature profiles`);
  return { history, checksum: hash.digest('hex').slice(0, 16) };
}

/**
 * Order-size history from deliveries_train.csv: only aggregates (medians, frequencies) are kept,
 * never raw rows. Used for the store-manager load estimate and the synthetic Kandy demand.
 */
export function readHistory(dataDir: string): { history: OutletHistory; profiles: (typeof unitProfiles.$inferInsert)[]; rows: number } {
  const header = ['delivery_id', 'order_date', 'dispatch_date', 'dispatch_status', 'outlet_id', 'brand', 'district', 'depot', 'temp_requirement', 'order_units', 'order_weight_kg', 'order_volume_m3', 'route_id', 'seq_in_route', 'vehicle_id', 'vehicle_type', 'vehicle_temp', 'planned_arrival_time', 'window_open_time', 'window_close_time'];
  let rows: Record<string, string>[];
  try {
    rows = loadCsv(dataDir, 'Training Data/deliveries_train.csv', header);
  } catch (e) {
    if (e instanceof SeedError && e.message.startsWith('Missing')) {
      throw new SeedError('Training Data/deliveries_train.csv is required for order sizes. Add the full competition bundle to data/source/.');
    }
    throw e;
  }
  const units = new Map<string, number[]>();
  const kgU = new Map<string, number[]>();
  const m3U = new Map<string, number[]>();
  const dayCount = new Map<string, Set<string>>();
  const weekdays = new Map<string, number[]>();
  const brandTemp = new Map<string, { kg: number; m3: number; units: number; n: number }>();
  const allDays = new Set<string>();
  for (const r of rows) {
    const u = Number(r.order_units);
    const kg = Number(r.order_weight_kg);
    const m3 = Number(r.order_volume_m3);
    if (!(u > 0 && kg > 0 && m3 > 0)) continue;
    const temp = oneOf(r.temp_requirement, TEMP_REQUIREMENTS, 'temp_requirement');
    const key = `${r.outlet_id}|${temp}`;
    const day = r.order_date!;
    allDays.add(day);
    (units.get(key) ?? units.set(key, []).get(key)!).push(u);
    (kgU.get(key) ?? kgU.set(key, []).get(key)!).push(kg / u);
    (m3U.get(key) ?? m3U.set(key, []).get(key)!).push(m3 / u);
    (dayCount.get(key) ?? dayCount.set(key, new Set()).get(key)!).add(day);
    const wd = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
    const w = weekdays.get(r.outlet_id!) ?? weekdays.set(r.outlet_id!, [0, 0, 0, 0, 0, 0, 0]).get(r.outlet_id!)!;
    w[wd]!++;
    const bt = `${r.brand}|${temp}`;
    const agg = brandTemp.get(bt) ?? { kg: 0, m3: 0, units: 0, n: 0 };
    agg.kg += kg;
    agg.m3 += m3;
    agg.units += u;
    agg.n++;
    brandTemp.set(bt, agg);
  }
  const perOutletTemp: OutletHistory['perOutletTemp'] = new Map();
  const frequency = new Map<string, number>();
  for (const [key, us] of units) {
    perOutletTemp.set(key, {
      units: median(us),
      kgPerUnit: median(kgU.get(key)!),
      m3PerUnit: median(m3U.get(key)!),
      days: dayCount.get(key)!.size,
    });
    frequency.set(key, dayCount.get(key)!.size / Math.max(1, allDays.size));
  }
  const weekday = new Map<string, number>();
  for (const [o, w] of weekdays) weekday.set(o, w.indexOf(Math.max(...w)));
  const profiles = [...brandTemp].map(([k, a]) => {
    const [brand, temp] = k.split('|') as [(typeof BRANDS)[number], (typeof TEMP_REQUIREMENTS)[number]];
    return { brand, temp, kgPerUnit: a.kg / a.units, m3PerUnit: a.m3 / a.units, sampleSize: a.n };
  });
  return { history: { perOutletTemp, frequency, weekday, totalDays: allDays.size }, profiles, rows: rows.length };
}
