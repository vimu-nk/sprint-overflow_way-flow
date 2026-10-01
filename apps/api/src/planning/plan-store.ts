import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  type AllocationContext,
  type AllocationTrip,
  assertTransition,
  computeTripMetrics,
  type Depot,
  isoWeekStart,
  ORDER_TRANSITIONS,
  type OrderStatus,
  priorityScore,
  reasonText,
  type ReasonCode,
  type DeferralClass,
  scheduleTrip,
  sequenceStops,
  serviceAllowance,
  type TripSchedule,
  type TripStatus,
} from '@wayflow/shared';
import { and, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/drizzle.module.js';
import { decisions, orders, outlets, plans, stops, trips } from '../db/schema.js';
import { ReferenceService } from '../reference/reference.service.js';
import type { PlanOrder } from './allocation.js';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type PlanRow = typeof plans.$inferSelect;
export type TripRow = typeof trips.$inferSelect;
export type StopRow = typeof stops.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;

/** Orders that take part in planning for a run date (drafts and cancellations never do). */
export const PLANNABLE: OrderStatus[] = ['confirmed', 'planned', 'published', 'deferred', 'loaded', 'departed', 'delivered', 'partial', 'failed', 'received', 'disputed'];
/** Trips whose contents are fixed: goods are on the truck or delivered. */
export const LOCKED_TRIP: TripStatus[] = ['departed', 'completed'];

export interface PlanningState {
  date: string;
  depot: Depot;
  plan: PlanRow | null;
  ctx: AllocationContext;
  orders: Map<string, OrderRow & PlanOrder>;
  liveTrips: TripRow[];
  liveStops: StopRow[];
  /** Current allocation read back from the DB. */
  allocation: AllocationTrip[];
  operating: boolean;
}

export interface DecisionInput {
  decision: 'served' | 'deferred';
  reasonCode?: ReasonCode;
  deferralClass?: DeferralClass;
  explanation?: string;
  storeReason?: string;
  secondConsecutive?: boolean;
}

@Injectable()
export class PlanStore {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ref: ReferenceService,
  ) {}

  async load(date: string, depot: Depot, isOperating: boolean, db: Db | Tx = this.db): Promise<PlanningState> {
    const [plan] = await db.select().from(plans).where(and(eq(plans.runDate, date), eq(plans.depot, depot)));
    const outletMap = await this.ref.outlets();
    const vehicleMap = await this.ref.vehicles();
    const depotVehicles = [...vehicleMap.values()].filter((v) => v.depot === depot);
    const statuses = await this.ref.vehicleStatuses(date);
    const orderRows = await db
      .select({ o: orders })
      .from(orders)
      .innerJoin(outlets, eq(outlets.outletId, orders.outletId))
      .where(and(eq(orders.runDate, date), eq(outlets.depot, depot), inArray(orders.status, PLANNABLE)));
    const om = new Map<string, OrderRow & PlanOrder>();
    for (const { o } of orderRows) {
      const outlet = outletMap.get(o.outletId)!;
      om.set(o.ref, {
        ...o,
        priority: priorityScore({
          brand: o.brand,
          temp: o.temp,
          deferredYesterday: o.deferredYesterday,
          daysSinceLastServed: o.daysSinceLastServed,
          windowCloseMin: outlet.windowCloseMin,
        }),
      });
    }
    const liveTrips = plan
      ? await db.select().from(trips).where(and(eq(trips.planId, plan.id), ne(trips.status, 'cancelled')))
      : [];
    const liveStops = liveTrips.length
      ? await db
          .select()
          .from(stops)
          .where(and(inArray(stops.tripId, liveTrips.map((t) => t.id)), ne(stops.status, 'skipped')))
      : [];
    const refById = new Map([...om.values()].map((o) => [o.id, o.ref]));
    const allocation: AllocationTrip[] = liveTrips
      .map((t) => ({
        vehicleId: t.vehicleId,
        tripNo: t.tripNo,
        orderRefs: liveStops
          .filter((s) => s.tripId === t.id)
          .sort((a, b) => a.seq - b.seq)
          .map((s) => refById.get(s.orderId))
          .filter((r): r is string => !!r),
      }))
      .filter((t) => t.orderRefs.length > 0);

    // Fuel already committed this ISO week, before this date, on other plans' live trips.
    const weekStart = isoWeekStart(date);
    const fuelRows = await db
      .select({ vehicleId: trips.vehicleId, litres: sql<number>`coalesce(sum((${trips.metrics}->>'fuelL')::float), 0)` })
      .from(trips)
      .where(and(gte(trips.runDate, weekStart), lt(trips.runDate, date), ne(trips.status, 'cancelled')))
      .groupBy(trips.vehicleId);
    const ctx: AllocationContext = {
      date,
      isOperatingDay: isOperating,
      orders: new Map([...om.values()].map((o) => [o.ref, { ref: o.ref, outletId: o.outletId, brand: o.brand, temp: o.temp, weightKg: o.weightKg, volumeM3: o.volumeM3, priority: o.priority } as PlanOrder])),
      outlets: new Map([...outletMap.values()].filter((o) => o.depot === depot).map((o) => [o.outletId, ReferenceService.ruleOutlet(o)])),
      vehicles: new Map(depotVehicles.map((v) => [v.vehicleId, ReferenceService.ruleVehicle(v, statuses.get(v.vehicleId) ?? 'available')])),
      travel: new Map([...(await this.ref.travel()).values()].filter((t) => t.depot === depot).map((t) => [t.district, t])),
      allowance: await this.ref.allowance(),
      fuelUsedL: new Map(fuelRows.map((r) => [r.vehicleId, Number(r.litres)])),
    };
    return { date, depot, plan: plan ?? null, ctx, orders: om, liveTrips, liveStops, allocation, operating: isOperating };
  }

  /** Sequence and time every trip; trip 2 leaves after trip 1 is back. Locked trips keep their departure. */
  async schedule(state: PlanningState, allocation: AllocationTrip[]): Promise<Map<string, { seq: string[]; schedule: TripSchedule }>> {
    const out = new Map<string, { seq: string[]; schedule: TripSchedule }>();
    const byVehicle = new Map<string, AllocationTrip[]>();
    for (const t of allocation) byVehicle.set(t.vehicleId, [...(byVehicle.get(t.vehicleId) ?? []), t]);
    const factors = new Map<string, Awaited<ReturnType<ReferenceService['travelFactor']>>>();
    for (const [vehicleId, list] of byVehicle) {
      let earliest = 0;
      for (const t of [...list].sort((a, b) => a.tripNo - b.tripNo)) {
        const items = t.orderRefs.map((r) => ({ order: state.ctx.orders.get(r)!, outlet: state.ctx.outlets.get(state.ctx.orders.get(r)!.outletId)! }));
        const live = state.liveTrips.find((x) => x.vehicleId === vehicleId && x.tripNo === t.tripNo);
        const locked = live && LOCKED_TRIP.includes(live.status);
        // Locked trips keep their loaded order; others are re-sequenced.
        const seq = locked ? items : sequenceStops(items);
        const district = items[0]!.outlet.district;
        if (!factors.has(district)) factors.set(district, await this.ref.travelFactor(district, state.date));
        const service = seq.map((x) => serviceAllowance(state.ctx.allowance, x.order.brand, x.outlet.dockType));
        const schedule = scheduleTrip(seq, state.ctx.travel.get(district)!, service, {
          earliestDepartMin: earliest,
          factor: factors.get(district),
          fixedDepartMin: locked ? live.departMin : undefined,
        });
        out.set(`${vehicleId}-T${t.tripNo}`, { seq: seq.map((x) => x.order.ref), schedule });
        earliest = schedule.returnMin;
      }
    }
    return out;
  }

  /**
   * Persist an allocation as a diff against what is stored: unchanged trips and stops keep their
   * ids (so loader check-offs and delivery records survive a re-plan), removed trips are cancelled,
   * moved orders get a new stop and the old one is marked skipped.
   */
  async apply(
    tx: Tx,
    state: PlanningState,
    planId: string,
    allocation: AllocationTrip[],
    decided: Map<string, DecisionInput>,
    role: 'dispatcher' | 'system',
  ): Promise<{ added: string[]; removed: string[]; moved: string[] }> {
    const sched = await this.schedule(state, allocation);
    const liveByKey = new Map(state.liveTrips.map((t) => [`${t.vehicleId}-T${t.tripNo}`, t]));
    const stopByOrder = new Map(state.liveStops.map((s) => [s.orderId, s]));
    const tripIdByKey = new Map<string, string>();
    const added: string[] = [];
    const removed: string[] = [];
    const moved: string[] = [];

    for (const t of allocation) {
      const key = `${t.vehicleId}-T${t.tripNo}`;
      const metrics = computeTripMetrics(t, state.ctx);
      const s = sched.get(key)!;
      const first = state.ctx.orders.get(t.orderRefs[0]!)!;
      const district = state.ctx.outlets.get(first.outletId)!.district;
      const m = {
        weightKg: metrics.weightKg,
        volumeM3: metrics.volumeM3,
        outboundMin: metrics.minutes.outbound,
        interStopMin: metrics.minutes.interStop,
        handlingMin: metrics.minutes.handling,
        tripMin: metrics.minutes.total,
        km: metrics.km,
        fuelL: Math.round(metrics.fuelL * 10) / 10,
      };
      const existing = liveByKey.get(key);
      if (existing) {
        const before = new Set(state.liveStops.filter((x) => x.tripId === existing.id).map((x) => x.orderId));
        const gained = t.orderRefs.some((r) => !before.has(state.orders.get(r)!.id));
        await tx
          .update(trips)
          .set({
            brand: first.brand,
            district,
            metrics: m,
            departMin: s.schedule.departMin,
            returnMin: s.schedule.returnMin,
            // New goods on a loaded truck: the loader must load again.
            status: gained && existing.status === 'ready' ? 'loading' : existing.status,
            readyAt: gained && existing.status === 'ready' ? null : existing.readyAt,
          })
          .where(eq(trips.id, existing.id));
        tripIdByKey.set(key, existing.id);
      } else {
        const [row] = await tx
          .insert(trips)
          .values({
            planId,
            runDate: state.date,
            vehicleId: t.vehicleId,
            tripNo: t.tripNo,
            brand: first.brand,
            district,
            metrics: m,
            departMin: s.schedule.departMin,
            returnMin: s.schedule.returnMin,
          })
          .returning({ id: trips.id });
        tripIdByKey.set(key, row!.id);
      }
    }
    // Trips that disappeared.
    const keep = new Set(tripIdByKey.values());
    for (const t of state.liveTrips) {
      if (keep.has(t.id)) continue;
      if (LOCKED_TRIP.includes(t.status)) continue;
      await tx.update(trips).set({ status: 'cancelled' }).where(eq(trips.id, t.id));
    }
    // Stops.
    const placed = new Set<string>();
    for (const t of allocation) {
      const key = `${t.vehicleId}-T${t.tripNo}`;
      const tripId = tripIdByKey.get(key)!;
      const s = sched.get(key)!;
      for (const [i, ref] of s.seq.entries()) {
        const order = state.orders.get(ref)!;
        const st = s.schedule.stops[i]!;
        placed.add(order.id);
        const prev = stopByOrder.get(order.id);
        const values = { seq: i + 1, plannedArrivalMin: Math.round(st.serviceStartMin), serviceMin: st.serviceMin, late: st.late };
        if (prev && prev.tripId === tripId) {
          await tx.update(stops).set(values).where(eq(stops.id, prev.id));
          continue;
        }
        if (prev) {
          await tx.update(stops).set({ status: 'skipped' }).where(eq(stops.id, prev.id));
          moved.push(ref);
        } else {
          added.push(ref);
        }
        await tx.insert(stops).values({ tripId, orderId: order.id, ...values });
      }
    }
    for (const s of state.liveStops) {
      if (placed.has(s.orderId)) continue;
      if (s.status !== 'pending') continue;
      await tx.update(stops).set({ status: 'skipped' }).where(eq(stops.id, s.id));
      const ref = [...state.orders.values()].find((o) => o.id === s.orderId)?.ref;
      if (ref) removed.push(ref);
    }

    // Decisions (keep the dispatcher's edited store text and acknowledgements).
    const existing = await tx.select().from(decisions).where(eq(decisions.planId, planId));
    const prevDecision = new Map(existing.map((d) => [d.orderId, d]));
    for (const [ref, d] of decided) {
      const order = state.orders.get(ref)!;
      const outlet = state.ctx.outlets.get(order.outletId)!;
      const prev = prevDecision.get(order.id);
      const keepText = prev && prev.decision === 'deferred' && d.decision === 'deferred' && prev.reasonCode === d.reasonCode;
      const storeReason =
        d.decision === 'deferred'
          ? (d.storeReason ?? (keepText ? prev!.storeReason : null) ?? reasonText(d.reasonCode!, { chilled: order.temp === 'chilled', vanOnly: outlet.parkingConstraint === 'van_only' }))
          : null;
      const values = {
        planId,
        orderId: order.id,
        decision: d.decision,
        reasonCode: d.decision === 'deferred' ? d.reasonCode! : null,
        deferralClass: d.decision === 'deferred' ? (d.deferralClass ?? 'choice') : null,
        explanation: d.decision === 'deferred' ? (d.explanation ?? null) : null,
        storeReason,
        priority: order.priority,
        secondConsecutive: d.decision === 'deferred' && order.deferredYesterday,
        acknowledged: keepText ? prev!.acknowledged : false,
        updatedAt: new Date(),
      };
      await tx
        .insert(decisions)
        .values(values)
        .onConflictDoUpdate({ target: [decisions.planId, decisions.orderId], set: values });
      // Order lifecycle (F6) through the transition table.
      const target: OrderStatus = d.decision === 'served' ? (order.status === 'published' ? 'published' : order.status === 'confirmed' || order.status === 'deferred' || order.status === 'planned' ? 'planned' : order.status) : 'deferred';
      if (target !== order.status && ['confirmed', 'planned', 'published', 'deferred'].includes(order.status)) {
        assertTransition('Order', ORDER_TRANSITIONS, order.status, target, role);
        await tx.update(orders).set({ status: target, updatedAt: new Date() }).where(eq(orders.id, order.id));
      }
    }
    return { added, removed, moved };
  }

  async nextOperatingDay(date: string, db: Db | Tx = this.db): Promise<string> {
    const rows = (await db.execute(
      sql`select date::text as d from calendar_days where date > ${date} and is_operating order by date limit 1`,
    )).rows as { d: string }[];
    if (rows[0]) return rows[0].d;
    // Outside calendar.csv: Sunday is closed (specs/10 §4).
    let d = addDays(date, 1);
    while (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) d = addDays(d, 1);
    return d;
  }
}
