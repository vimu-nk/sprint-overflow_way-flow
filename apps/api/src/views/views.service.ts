import { Inject, Injectable } from '@nestjs/common';
import {
  budgetFor,
  budgetKind,
  colomboParts,
  type DecisionDto,
  effectiveWindow,
  minToHhmm,
  type OrderDto,
  type OutletDto,
  type PlanChangeDto,
  type StopDto,
  type TripDetailDto,
  type TripDto,
} from '@wayflow/shared';
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm';
import { ClockService } from '../clock/clock.service.js';
import { DB, type Db } from '../db/drizzle.module.js';
import {
  attachments,
  decisions,
  exceptions,
  loadFlags,
  orders,
  planVersions,
  plans,
  problemReports,
  receipts,
  stops,
  trips,
  users,
} from '../db/schema.js';
import { type OutletRow, ReferenceService } from '../reference/reference.service.js';
import type { DiffEntry } from '../planning/planning.service.js';

type TripRow = typeof trips.$inferSelect;
type StopRow = typeof stops.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

/** A departed vehicle that has not reported for this long counts as "no signal". */
export const STALE_SIGNAL_MIN = 30;
const photoUrl = (id: string) => `/api/v1/attachments/${id}/content`;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

@Injectable()
export class ViewsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ref: ReferenceService,
    private readonly clock: ClockService,
  ) {}

  outlet(o: OutletRow): OutletDto {
    return {
      outletId: o.outletId,
      name: o.name,
      brand: o.brand,
      district: o.district,
      depot: o.depot,
      dockType: o.dockType,
      parkingConstraint: o.parkingConstraint,
      windowOpen: minToHhmm(o.windowOpenMin),
      windowClose: minToHhmm(o.windowCloseMin),
      mallWindow: o.mallOpenMin !== null && o.mallCloseMin !== null ? `${minToHhmm(o.mallOpenMin)} to ${minToHhmm(o.mallCloseMin)}` : null,
    };
  }

  /** Live ETAs for a trip's pending stops (adjusted model + reported delay). Keyed by stop id. */
  async etas(trip: TripRow, tripStops: StopRow[]): Promise<Map<string, { eta: number; late: boolean }>> {
    const out = new Map<string, { eta: number; late: boolean }>();
    const sorted = [...tripStops].sort((a, b) => a.seq - b.seq);
    if (trip.status !== 'departed') {
      for (const s of sorted) out.set(s.id, { eta: s.plannedArrivalMin, late: s.late });
      return out;
    }
    const outlets = await this.ref.outlets();
    const travel = (await this.ref.travel()).get(trip.district)!;
    const factor = await this.ref.travelFactor(trip.district, trip.runDate);
    const lastDone = [...sorted].reverse().find((s) => s.completedAt);
    let clock = lastDone?.completedAt ? colomboParts(lastDone.completedAt).minute : trip.departedAt ? colomboParts(trip.departedAt).minute : trip.departMin;
    let prevOutlet: string | null = null;
    if (lastDone) {
      const o = (await this.db.select({ outletId: orders.outletId }).from(orders).where(eq(orders.id, lastDone.orderId)))[0];
      prevOutlet = o?.outletId ?? null;
    }
    const now = colomboParts(await this.clock.now()).minute;
    clock = Math.max(clock, Math.min(now, clock + 600));
    let delay = trip.reportedDelayMin;
    const orderIds = sorted.map((s) => s.orderId);
    const orderOutlet = new Map((await this.db.select({ id: orders.id, outletId: orders.outletId }).from(orders).where(inArray(orders.id, orderIds))).map((o) => [o.id, o.outletId]));
    for (const s of sorted) {
      if (s.status !== 'pending' && s.status !== 'arrived') continue;
      const outletId = orderOutlet.get(s.orderId)!;
      const outlet = outlets.get(outletId)!;
      const leg = prevOutlet === null ? travel.depotToDistrictFreeflowMin : prevOutlet === outletId ? 0 : travel.interStopFreeflowMin;
      let arrival = clock + leg * factor(clock) + delay;
      delay = 0;
      arrival = Math.max(arrival, s.plannedArrivalMin - 0);
      const w = effectiveWindow(ReferenceService.ruleOutlet(outlet));
      const start = prevOutlet === outletId ? arrival : Math.max(arrival, w.open);
      out.set(s.id, { eta: Math.round(start), late: start > w.close });
      clock = start + s.serviceMin;
      prevOutlet = outletId;
    }
    return out;
  }

  /** Build TripDto rows; budgets add up both trips of a vehicle on the same day. */
  async tripDtos(rows: TripRow[]): Promise<TripDto[]> {
    if (!rows.length) return [];
    const vehicles = await this.ref.vehicles();
    const outlets = await this.ref.outlets();
    const dates = [...new Set(rows.map((t) => t.runDate))];
    const vehicleIds = [...new Set(rows.map((t) => t.vehicleId))];
    const siblings = await this.db
      .select()
      .from(trips)
      .where(and(inArray(trips.runDate, dates), inArray(trips.vehicleId, vehicleIds), ne(trips.status, 'cancelled')));
    const tripIds = rows.map((t) => t.id);
    const st = await this.db.select().from(stops).where(and(inArray(stops.tripId, tripIds), ne(stops.status, 'skipped')));
    const orderRows = st.length ? await this.db.select({ id: orders.id, outletId: orders.outletId, temp: orders.temp }).from(orders).where(inArray(orders.id, st.map((s) => s.orderId))) : [];
    const orderInfo = new Map(orderRows.map((o) => [o.id, o]));
    const drivers = await this.db.select({ name: users.name, vehicleId: users.vehicleId }).from(users).where(and(eq(users.role, 'driver'), inArray(users.vehicleId, vehicleIds)));
    const driverName = new Map(drivers.map((d) => [d.vehicleId, d.name]));
    const flagRows = await this.db.select({ tripId: loadFlags.tripId }).from(loadFlags).where(inArray(loadFlags.tripId, tripIds));
    const issueRows = await this.db
      .select({ tripId: exceptions.tripId, type: exceptions.type })
      .from(exceptions)
      .where(and(inArray(exceptions.tripId, tripIds)));
    const now = (await this.clock.now()).getTime();
    const out: TripDto[] = [];
    for (const t of rows) {
      const v = vehicles.get(t.vehicleId)!;
      const mine = st.filter((s) => s.tripId === t.id);
      const kind = budgetKind(t.brand);
      const sameBudget = siblings.filter((s) => s.vehicleId === t.vehicleId && s.runDate === t.runDate && budgetKind(s.brand) === kind);
      const used = sameBudget.reduce((a, s) => a + (s.metrics.tripMin ?? 0), 0);
      const etas = t.status === 'departed' ? await this.etas(t, mine) : null;
      out.push({
        id: t.id,
        key: `${t.vehicleId}-T${t.tripNo}`,
        planId: t.planId,
        vehicleId: t.vehicleId,
        vehicleType: v.type,
        vehicleTemp: v.temp,
        depot: v.depot,
        tripNo: t.tripNo,
        brand: t.brand,
        district: t.district,
        status: t.status,
        depart: minToHhmm(t.departMin),
        back: minToHhmm(t.returnMin),
        stopCount: mine.length,
        stopsDone: mine.filter((s) => ['delivered', 'partial', 'failed'].includes(s.status)).length,
        weight: { used: t.metrics.weightKg ?? 0, cap: v.weightCapKg },
        volume: { used: t.metrics.volumeM3 ?? 0, cap: v.volumeCapM3 },
        tripMin: t.metrics.tripMin ?? 0,
        budget: { used, cap: budgetFor(kind), kind, bothTrips: sameBudget.length > 1 },
        fuelL: t.metrics.fuelL ?? 0,
        weeklyQuotaL: v.weeklyFuelQuotaL,
        tripsOnVehicle: siblings.filter((s) => s.vehicleId === t.vehicleId && s.runDate === t.runDate).length,
        driverName: driverName.get(t.vehicleId) ?? null,
        loadedCount: mine.filter((s) => s.loaded).length,
        lastSignalAt: t.status === 'departed' ? iso(t.lastSignalAt ?? t.departedAt) : null,
        reportedDelayMin: t.reportedDelayMin,
        stale: t.status === 'departed' && now - (t.lastSignalAt ?? t.departedAt ?? new Date(now)).getTime() > STALE_SIGNAL_MIN * 60_000,
        lateRisk: etas ? [...etas.values()].some((e) => e.late) : mine.some((s) => s.late && s.status === 'pending'),
        hasIssue: issueRows.some((i) => i.tripId === t.id && ['receipt_issue', 'failed_delivery', 'road_problem'].includes(i.type)),
        hasShortfall: flagRows.some((f) => f.tripId === t.id),
        chilled: mine.some((s) => orderInfo.get(s.orderId)?.temp === 'chilled'),
        vanOnly: mine.some((s) => outlets.get(orderInfo.get(s.orderId)?.outletId ?? '')?.parkingConstraint === 'van_only'),
      });
    }
    return out;
  }

  /** Is this departed trip silent for longer than the stale threshold? */
  async isStale(t: { status: string; lastSignalAt: Date | null; departedAt: Date | null }): Promise<boolean> {
    if (t.status !== 'departed') return false;
    const last = t.lastSignalAt ?? t.departedAt;
    if (!last) return false;
    return (await this.clock.now()).getTime() - last.getTime() > STALE_SIGNAL_MIN * 60_000;
  }

  async tripDetail(t: TripRow): Promise<TripDetailDto> {
    const [base] = await this.tripDtos([t]);
    const outlets = await this.ref.outlets();
    const st = await this.db.select().from(stops).where(and(eq(stops.tripId, t.id), ne(stops.status, 'skipped')));
    const orderRows = st.length ? await this.db.select().from(orders).where(inArray(orders.id, st.map((s) => s.orderId))) : [];
    const orderById = new Map(orderRows.map((o) => [o.id, o]));
    const flags = await this.db.select().from(loadFlags).where(eq(loadFlags.tripId, t.id));
    const atts = await this.db
      .select()
      .from(attachments)
      .where(or(and(eq(attachments.entityType, 'stop'), inArray(attachments.entityId, st.length ? st.map((s) => s.id) : ['00000000-0000-0000-0000-000000000000'])), and(eq(attachments.entityType, 'flag'), inArray(attachments.entityId, flags.length ? flags.map((f) => f.id) : ['00000000-0000-0000-0000-000000000000']))));
    const etas = await this.etas(t, st);
    const stopDtos: StopDto[] = st
      .sort((a, b) => a.seq - b.seq)
      .map((s) => {
        const o = orderById.get(s.orderId)!;
        const att = atts.find((a) => a.entityType === 'stop' && a.entityId === s.id);
        const e = etas.get(s.id);
        return {
          id: s.id,
          seq: s.seq,
          order: { id: o.id, ref: o.ref, temp: o.temp, units: o.units, weightKg: o.weightKg, volumeM3: o.volumeM3, status: o.status },
          outlet: this.outlet(outlets.get(o.outletId)!),
          status: s.status,
          plannedArrival: minToHhmm(s.plannedArrivalMin),
          eta: t.status === 'departed' && e ? minToHhmm(e.eta) : null,
          late: e?.late ?? s.late,
          serviceMin: s.serviceMin,
          loaded: s.loaded,
          completedAt: iso(s.completedAt),
          deliveredUnits: s.deliveredUnits,
          failureReason: s.failureReason,
          recipientName: s.recipientName,
          shortNote: s.shortNote,
          hasPhoto: !!att,
          photoUrl: att ? photoUrl(att.id) : null,
          flags: flags
            .filter((f) => f.stopId === s.id)
            .map((f) => {
              const fa = atts.find((a) => a.entityType === 'flag' && a.entityId === f.id);
              return { id: f.id, kind: f.kind, unitsAffected: f.unitsAffected, note: f.note, at: f.createdAt.toISOString(), photoUrl: fa ? photoUrl(fa.id) : null };
            }),
        };
      });
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, t.planId));
    const changes = await this.changesFor(t, plan?.publishedVersion ?? null);
    const problems = await this.db.select().from(problemReports).where(eq(problemReports.tripId, t.id)).orderBy(desc(problemReports.createdAt));
    return {
      ...base!,
      runDate: t.runDate,
      stops: stopDtos,
      planVersion: plan?.publishedVersion ?? null,
      seenVersion: t.seenVersion,
      changes,
      problems: problems.map((p) => ({ id: p.id, kind: p.kind, delayMin: p.delayMin, note: p.note, at: (p.createdAtClient ?? p.createdAt).toISOString() })),
    };
  }

  /** Diff entries of the latest published version that touch this trip (plan-changed banner). */
  async changesFor(t: TripRow, version: number | null): Promise<PlanChangeDto[]> {
    if (!version || version < 2) return [];
    const [pv] = await this.db.select().from(planVersions).where(and(eq(planVersions.planId, t.planId), eq(planVersions.version, version)));
    const key = `${t.vehicleId}-T${t.tripNo}`;
    const entries = ((pv?.diff ?? []) as DiffEntry[]).filter((d) => d.from === key || d.to === key);
    if (!entries.length) return [];
    const outlets = await this.ref.outlets();
    const rows = await this.db.select().from(orders).where(inArray(orders.ref, entries.map((e) => e.ref)));
    const byRef = new Map(rows.map((r) => [r.ref, r]));
    return entries.map((e) => ({
      ...e,
      outletName: outlets.get(e.outletId)?.name ?? e.outletId,
      weightKg: byRef.get(e.ref)?.weightKg ?? 0,
      volumeM3: byRef.get(e.ref)?.volumeM3 ?? 0,
    }));
  }

  /** OrderDto rows with trip, ETA, decision, receipt and carry-over joined in. */
  async orderDtos(rows: OrderRow[]): Promise<OrderDto[]> {
    if (!rows.length) return [];
    const outlets = await this.ref.outlets();
    const ids = rows.map((o) => o.id);
    const st = await this.db.select().from(stops).where(and(inArray(stops.orderId, ids), ne(stops.status, 'skipped')));
    const tripRows = st.length ? await this.db.select().from(trips).where(inArray(trips.id, [...new Set(st.map((s) => s.tripId))])) : [];
    const tripById = new Map(tripRows.map((t) => [t.id, t]));
    const etaByStop = new Map<string, { eta: number; late: boolean }>();
    for (const t of tripRows.filter((x) => x.status === 'departed')) {
      const all = await this.db.select().from(stops).where(and(eq(stops.tripId, t.id), ne(stops.status, 'skipped')));
      for (const [k, v] of await this.etas(t, all)) etaByStop.set(k, v);
    }
    // Latest decision per order (one plan per date/depot, so at most one row each).
    const decs = await this.db.select().from(decisions).where(inArray(decisions.orderId, ids));
    const decByOrder = new Map(decs.map((d) => [d.orderId, d]));
    const rec = await this.db.select().from(receipts).where(inArray(receipts.orderId, ids));
    const recByOrder = new Map(rec.map((r) => [r.orderId, r]));
    const carried = await this.db.select({ ref: orders.ref, runDate: orders.runDate, from: orders.carriedFromId }).from(orders).where(inArray(orders.carriedFromId, ids));
    const carriedBy = new Map(carried.map((c) => [c.from!, c]));
    return rows.map((o) => {
      const s = st.find((x) => x.orderId === o.id);
      const t = s ? tripById.get(s.tripId) : undefined;
      const d = decByOrder.get(o.id);
      const e = s ? etaByStop.get(s.id) : undefined;
      const r = recByOrder.get(o.id);
      const c = carriedBy.get(o.id);
      const decision: DecisionDto | null = d
        ? {
            decision: d.decision,
            reasonCode: d.reasonCode,
            deferralClass: d.deferralClass,
            explanation: d.explanation,
            storeReason: d.storeReason,
            secondConsecutive: d.secondConsecutive,
            acknowledged: d.acknowledged,
            notified: !!d.notifiedAt,
          }
        : null;
      return {
        id: o.id,
        ref: o.ref,
        outlet: this.outlet(outlets.get(o.outletId)!),
        temp: o.temp,
        units: o.units,
        weightKg: o.weightKg,
        volumeM3: o.volumeM3,
        runDate: o.runDate,
        status: o.status,
        source: o.source,
        deferredYesterday: o.deferredYesterday,
        daysSinceLastServed: o.daysSinceLastServed,
        placedAfterCutoff: o.placedAfterCutoff,
        createdAt: o.createdAt.toISOString(),
        tripKey: t ? `${t.vehicleId}-T${t.tripNo}` : null,
        tripId: t?.id ?? null,
        plannedArrival: s ? minToHhmm(s.plannedArrivalMin) : null,
        eta: e && t?.status === 'departed' && (s?.status === 'pending' || s?.status === 'arrived') ? minToHhmm(e.eta) : null,
        lateRisk: e?.late ?? s?.late ?? false,
        deliveredAt: iso(s?.completedAt),
        deliveredUnits: s?.deliveredUnits ?? o.deliveredUnits,
        lastUpdateAt: t?.status === 'departed' ? iso(t.lastSignalAt ?? t.departedAt) : null,
        decision,
        carriedTo: c ? { ref: c.ref, runDate: c.runDate } : null,
        receipt: r ? { unitsReceived: r.unitsReceived, damagedUnits: r.damagedUnits, problem: r.problem, note: r.note, at: r.createdAt.toISOString() } : null,
      };
    });
  }
}
