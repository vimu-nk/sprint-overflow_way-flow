import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AllocationTrip,
  assertTransition,
  computeTripMetrics,
  type Depot,
  formatDayMonth,
  formatKg,
  formatM3,
  minToHhmm,
  PLAN_TRANSITIONS,
  type PlanStatus,
  type ReasonCode,
  REASON_CODE_LABEL,
  tripKey,
  validateAllocation,
  type Violation,
  type VehicleDayStatus,
} from '@wayflow/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService, type AuditMeta } from '../audit/audit.service.js';
import { ClockService } from '../clock/clock.service.js';
import type { SessionUser } from '../common/decorators.js';
import { AppError, conflict, notFound } from '../common/errors.js';
import { DB, type Db } from '../db/drizzle.module.js';
import { decisions, orders, outlets, planVersions, plans, trips, vehicleDays } from '../db/schema.js';
import { ExceptionsService } from '../exceptions/exceptions.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ReferenceService } from '../reference/reference.service.js';
import { enforceMallWindows, explainDeferral, greedyAllocate, repair } from './allocation.js';
import { type DecisionInput, LOCKED_TRIP, PlanStore, type PlanningState } from './plan-store.js';
import { PlannerClient } from './planner.client.js';

export interface PlanSummary {
  served: number;
  deferred: number;
  unavoidable: number;
  choice: number;
  byBrand: Record<string, { served: number; deferred: number }>;
  byReason: Partial<Record<ReasonCode, number>>;
  limiting: { code: ReasonCode; label: string; deferrals: number } | null;
  trips: number;
  vehiclesUsed: number;
  vehiclesAvailable: number;
  engine: string;
  engineStatus: string;
  solveMs: number;
}

export interface DiffEntry {
  ref: string;
  outletId: string;
  change: 'added' | 'removed' | 'moved' | 'deferred';
  from?: string;
  to?: string;
}

@Injectable()
export class PlanningService {
  private readonly log = new Logger('Planning');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly store: PlanStore,
    private readonly planner: PlannerClient,
    private readonly clock: ClockService,
    private readonly ref: ReferenceService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly exceptionsSvc: ExceptionsService,
  ) {}

  private async state(date: string, depot: Depot) {
    const op = await this.clock.isOperatingMap([date]);
    return this.store.load(date, depot, op.get(date) ?? true);
  }

  // ---------------------------------------------------------------- run
  /** D-02: run the allocation for a depot and date (also used for re-plans after publish). */
  async run(date: string, depot: Depot, user: SessionUser | null, meta: AuditMeta = {}, reason = 'Allocation run') {
    const state = await this.state(date, depot);
    if (state.plan?.status === 'closed') throw conflict('plan_closed', 'This run is complete and can no longer be re-planned.');
    const available = new Set([...state.ctx.vehicles.values()].filter((v) => v.status === 'available').map((v) => v.vehicleId));
    const tripStatus = new Map(state.liveTrips.map((t) => [`${t.vehicleId}-T${t.tripNo}`, t.status]));

    // Locked trips on a vehicle that is now unavailable stay exactly as they are.
    const locked = state.allocation.filter((t) => LOCKED_TRIP.includes(tripStatus.get(tripKey(t.vehicleId, t.tripNo))!) && !available.has(t.vehicleId));
    const lockedRefs = new Set(locked.flatMap((t) => t.orderRefs));
    const pins: { ref: string; vehicle_id: string; trip_no: number }[] = [];
    const prefs: { ref: string; vehicle_id: string; trip_no: number }[] = [];
    for (const t of state.allocation) {
      if (!available.has(t.vehicleId)) continue;
      const st = tripStatus.get(tripKey(t.vehicleId, t.tripNo));
      const list = st && st !== 'planned' ? pins : prefs;
      for (const r of t.orderRefs) list.push({ ref: r, vehicle_id: t.vehicleId, trip_no: t.tripNo });
    }
    const engineOrders = [...state.orders.values()].filter((o) => !lockedRefs.has(o.ref));
    const pinnedRefs = new Set(pins.map((p) => p.ref));

    let allocation: AllocationTrip[];
    let engine = 'or-tools-cp-sat';
    let engineStatus: string;
    let solveMs = 0;
    const started = Date.now();
    if (!state.operating) {
      allocation = [];
      engineStatus = 'NON_OPERATING_DAY';
    } else {
      try {
        const res = await this.planner.plan({
          date,
          depot,
          orders: engineOrders.map((o) => {
            const outlet = state.ctx.outlets.get(o.outletId)!;
            return {
              ref: o.ref,
              brand: o.brand,
              district: outlet.district,
              chilled: o.temp === 'chilled',
              van_only: outlet.parkingConstraint === 'van_only',
              weight_kg: o.weightKg,
              volume_m3: o.volumeM3,
              service_min: state.ctx.allowance[`${o.brand}|${outlet.dockType}`] ?? 0,
              priority: o.priority,
            };
          }),
          vehicles: [...state.ctx.vehicles.values()]
            .filter((v) => v.status === 'available')
            .map((v) => ({
              vehicle_id: v.vehicleId,
              is_van: v.type === 'van',
              is_reefer: v.temp === 'reefer',
              weight_cap_kg: v.weightCapKg,
              volume_cap_m3: v.volumeCapM3,
              km_per_l: v.kmPerL,
              fuel_remaining_l: v.weeklyFuelQuotaL - (state.ctx.fuelUsedL.get(v.vehicleId) ?? 0),
            })),
          travel: Object.fromEntries(
            [...state.ctx.travel.values()].map((t) => [
              t.district,
              { outbound_min: t.depotToDistrictFreeflowMin, inter_stop_min: t.interStopFreeflowMin, outbound_km: t.depotToDistrictKm, inter_stop_km: t.interStopKm },
            ]),
          ),
          pins,
          preferences: prefs,
        });
        allocation = res.trips.map((t) => ({ vehicleId: t.vehicle_id, tripNo: t.trip_no, orderRefs: t.order_refs }));
        engineStatus = res.status;
        solveMs = res.solve_ms;
        if (res.status !== 'OPTIMAL' && res.status !== 'FEASIBLE') throw new Error(`planner status ${res.status}`);
      } catch (e) {
        // Degraded mode: the deterministic greedy engine in the API still produces a feasible plan.
        this.log.warn({ err: (e as Error).message }, 'planner unavailable, using greedy fallback');
        engine = 'greedy-fallback';
        const pinnedTrips: AllocationTrip[] = [];
        for (const p of pins) {
          let t = pinnedTrips.find((x) => x.vehicleId === p.vehicle_id && x.tripNo === p.trip_no);
          if (!t) pinnedTrips.push((t = { vehicleId: p.vehicle_id, tripNo: p.trip_no, orderRefs: [] }));
          t.orderRefs.push(p.ref);
        }
        allocation = greedyAllocate(state.ctx, engineOrders, pinnedTrips);
        engineStatus = 'FALLBACK';
        solveMs = Date.now() - started;
      }
    }

    const priority = new Map(engineOrders.map((o) => [o.ref, pinnedRefs.has(o.ref) ? Number.MAX_SAFE_INTEGER : o.priority]));
    const mall = enforceMallWindows(state.ctx, allocation, priority);
    allocation = mall.trips;
    const served = new Set(allocation.flatMap((t) => t.orderRefs));
    allocation = repair(
      state.ctx,
      allocation,
      engineOrders.filter((o) => !served.has(o.ref) && !mall.removed.includes(o.ref)),
    );

    // Defence in depth: the engine's output must satisfy every rule (specs/07 §2).
    const violations = validateAllocation(allocation, state.ctx);
    if (violations.length) {
      this.log.error({ violations }, 'engine produced an infeasible plan');
      throw new AppError('engine_infeasible', 'The planner produced a plan that breaks a rule. Nothing was saved.', 500, violations);
    }
    const finalServed = new Set(allocation.flatMap((t) => t.orderRefs));
    const decided = new Map<string, DecisionInput>();
    for (const o of engineOrders) {
      if (finalServed.has(o.ref)) decided.set(o.ref, { decision: 'served' });
      else decided.set(o.ref, { decision: 'deferred', ...explainDeferral(state.ctx, allocation, o, mall.removed.includes(o.ref)) });
    }
    const full = [...allocation, ...locked];
    const summary = this.summarise(state, full, decided, engine, engineStatus, solveMs);
    const wasPublished = state.plan && ['published', 'replanned'].includes(state.plan.status);
    const nextStatus: PlanStatus = wasPublished ? 'replanned' : 'generated';

    const planId = await this.db.transaction(async (tx) => {
      let id = state.plan?.id;
      if (!id) {
        const [row] = await tx.insert(plans).values({ runDate: date, depot, status: 'generated', engine, createdBy: user?.id ?? null, summary: summary as never }).returning({ id: plans.id });
        id = row!.id;
      } else {
        assertTransition('Plan', PLAN_TRANSITIONS, state.plan!.status, nextStatus, user ? 'dispatcher' : 'system');
        await tx.update(plans).set({ status: nextStatus, engine, summary: summary as never, updatedAt: new Date() }).where(eq(plans.id, id));
      }
      await this.store.apply(tx, state, id, full, decided, user ? 'dispatcher' : 'system');
      await this.audit.record(user, wasPublished ? 'plan.replan' : 'plan.run', { type: 'plan', id }, { date, depot, reason, engine, served: summary.served, deferred: summary.deferred }, meta, tx);
      return id;
    });
    await this.flagSecondDeferrals(date, depot, planId);
    const republished = await this.autoRepublish(planId, !!wasPublished, user, meta);
    await this.notifications.invalidate({ roles: ['dispatcher'] }, ['plans', 'orders', 'live']);
    return { planId, summary, republished };
  }

  private summarise(state: PlanningState, allocation: AllocationTrip[], decided: Map<string, DecisionInput>, engine: string, engineStatus: string, solveMs: number): PlanSummary {
    const byBrand: PlanSummary['byBrand'] = {};
    const byReason: PlanSummary['byReason'] = {};
    let unavoidable = 0;
    let choice = 0;
    const servedRefs = new Set(allocation.flatMap((t) => t.orderRefs));
    for (const o of state.orders.values()) {
      const b = (byBrand[o.brand] ??= { served: 0, deferred: 0 });
      const d = decided.get(o.ref);
      if (servedRefs.has(o.ref)) b.served++;
      else if (d?.decision === 'deferred') {
        b.deferred++;
        byReason[d.reasonCode!] = (byReason[d.reasonCode!] ?? 0) + 1;
        if (d.deferralClass === 'unavoidable') unavoidable++;
        else choice++;
      }
    }
    const top = (Object.entries(byReason) as [ReasonCode, number][]).sort((a, b) => b[1] - a[1])[0];
    return {
      served: servedRefs.size,
      deferred: unavoidable + choice,
      unavoidable,
      choice,
      byBrand,
      byReason,
      limiting: top ? { code: top[0], label: REASON_CODE_LABEL[top[0]], deferrals: top[1] } : null,
      trips: allocation.length,
      vehiclesUsed: new Set(allocation.map((t) => t.vehicleId)).size,
      vehiclesAvailable: [...state.ctx.vehicles.values()].filter((v) => v.status === 'available').length,
      engine,
      engineStatus,
      solveMs,
    };
  }

  /** F3: a second consecutive deferral is critical and needs explicit acknowledgement. */
  private async flagSecondDeferrals(date: string, depot: Depot, planId: string) {
    const rows = await this.db
      .select({ ref: orders.ref, outletId: orders.outletId, orderId: orders.id })
      .from(decisions)
      .innerJoin(orders, eq(orders.id, decisions.orderId))
      .where(and(eq(decisions.planId, planId), eq(decisions.secondConsecutive, true), eq(decisions.acknowledged, false)));
    for (const r of rows) {
      const created = await this.exceptionsSvc.raise({
        type: 'second_deferral',
        severity: 'critical',
        runDate: date,
        orderId: r.orderId,
        outletId: r.outletId,
        title: 'Second deferral',
        body: `${r.outletId} (${r.ref}) was deferred on the last run and is deferred again. Acknowledge before publishing.`,
        dedupeKey: `second-${r.orderId}`,
      });
      if (created) {
        await this.notifications.notify({
          type: 'deferral.second',
          severity: 'critical',
          title: `${r.outletId} deferred twice`,
          body: `${r.ref} for ${r.outletId} (${depot}) is deferred on two runs in a row. Review it before you publish.`,
          link: `/dispatcher/deferrals?date=${date}`,
          to: { roles: ['dispatcher'] },
        });
      }
    }
  }

  // ---------------------------------------------------------------- overrides
  private async locate(orderId: string) {
    const [row] = await this.db
      .select({ order: orders, depot: outlets.depot })
      .from(orders)
      .innerJoin(outlets, eq(outlets.outletId, orders.outletId))
      .where(eq(orders.id, orderId));
    if (!row) throw notFound('Order not found');
    const state = await this.state(row.order.runDate, row.depot);
    if (!state.plan) throw conflict('no_plan', 'Run the allocation for this depot first.');
    if (state.plan.status === 'closed') throw conflict('plan_closed', 'This run is complete.');
    return { order: state.orders.get(row.order.ref)!, state };
  }

  private nextPlanStatus(current: PlanStatus): PlanStatus {
    return current === 'generated' || current === 'edited' ? 'edited' : 'replanned';
  }

  private tripStatusOf(state: PlanningState, vehicleId: string, tripNo: number) {
    return state.liveTrips.find((t) => t.vehicleId === vehicleId && t.tripNo === tripNo)?.status;
  }

  /** Human sentence for a blocked move, in the Designathon wording. */
  private describeBlock(state: PlanningState, ref: string, key: string, candidate: AllocationTrip, violations: Violation[]): string {
    const o = state.ctx.orders.get(ref)!;
    const v = state.ctx.vehicles.get(candidate.vehicleId)!;
    const m = computeTripMetrics(candidate, state.ctx);
    const kg = violations.some((x) => x.rule === 'capacity_weight');
    const m3 = violations.some((x) => x.rule === 'capacity_volume');
    if (kg || m3) {
      const parts: string[] = [];
      if (kg) parts.push(`${formatKg(m.weightKg).replace(' kg', '')} of ${formatKg(v.weightCapKg)}`);
      if (m3) parts.push(`${formatM3(m.volumeM3).replace(' m³', '')} of ${formatM3(v.volumeCapM3)}`);
      const fine = !kg ? ` Weight is fine at ${formatKg(m.weightKg).replace(' kg', '')} of ${formatKg(v.weightCapKg)}, but a load must fit both.` : !m3 ? ` Volume is fine at ${formatM3(m.volumeM3)}, but a load must fit both.` : ' Both limits are broken.';
      return `Adding ${formatKg(o.weightKg)} and ${formatM3(o.volumeM3)} would make the load ${parts.join(' and ')}.${fine}`;
    }
    return violations.map((x) => x.message).join(' ');
  }

  /** D-04: move an order to another vehicle/trip. Hard rule violations block the move (plan unchanged). */
  async move(orderId: string, vehicleId: string, tripNo: number, reason: string, dryRun: boolean, user: SessionUser, meta: AuditMeta) {
    const { order, state } = await this.locate(orderId);
    const current = state.allocation.find((t) => t.orderRefs.includes(order.ref));
    if (current) {
      const st = this.tripStatusOf(state, current.vehicleId, current.tripNo);
      if (st && LOCKED_TRIP.includes(st)) throw conflict('trip_departed', `${tripKey(current.vehicleId, current.tripNo)} has left the depot; its orders cannot move.`);
      if (current.vehicleId === vehicleId && current.tripNo === tripNo) throw conflict('no_change', 'The order is already on that trip.');
    }
    const targetStatus = this.tripStatusOf(state, vehicleId, tripNo);
    if (targetStatus && LOCKED_TRIP.includes(targetStatus)) throw conflict('trip_departed', `${tripKey(vehicleId, tripNo)} has left the depot.`);
    if (!state.ctx.vehicles.has(vehicleId)) throw new AppError('home_depot', `${vehicleId} is not based at ${state.depot}.`, HttpStatus.UNPROCESSABLE_ENTITY);

    const next: AllocationTrip[] = state.allocation
      .map((t) => ({ ...t, orderRefs: t.orderRefs.filter((r) => r !== order.ref) }))
      .filter((t) => t.orderRefs.length > 0);
    let target = next.find((t) => t.vehicleId === vehicleId && t.tripNo === tripNo);
    if (!target) next.push((target = { vehicleId, tripNo, orderRefs: [] }));
    target.orderRefs.push(order.ref);

    const affected = new Set([vehicleId, current?.vehicleId].filter(Boolean) as string[]);
    const violations = validateAllocation(next.filter((t) => affected.has(t.vehicleId)), state.ctx);
    const key = tripKey(vehicleId, tripNo);
    const metrics = computeTripMetrics(target, state.ctx);
    const vehicle = state.ctx.vehicles.get(vehicleId)!;
    const preview = {
      tripKey: key,
      weightKg: metrics.weightKg,
      volumeM3: metrics.volumeM3,
      weightCapKg: vehicle.weightCapKg,
      volumeCapM3: vehicle.volumeCapM3,
      tripMin: metrics.minutes.total,
      stops: target.orderRefs.length,
    };
    if (violations.length) {
      const message = this.describeBlock(state, order.ref, key, target, violations);
      await this.audit.record(user, 'plan.override_blocked', { type: 'order', id: order.id }, { ref: order.ref, to: key, rules: violations.map((v) => v.rule) }, meta);
      return { ok: false as const, title: `Move blocked: ${order.ref} does not fit ${key}`, message, violations, preview };
    }
    if (dryRun) return { ok: true as const, preview, violations: [] };

    const decided = new Map<string, DecisionInput>([[order.ref, { decision: 'served' }]]);
    const status = this.nextPlanStatus(state.plan!.status);
    await this.db.transaction(async (tx) => {
      assertTransition('Plan', PLAN_TRANSITIONS, state.plan!.status, status, 'dispatcher');
      await this.store.apply(tx, state, state.plan!.id, next, decided, 'dispatcher');
      await tx.update(plans).set({ status, updatedAt: new Date() }).where(eq(plans.id, state.plan!.id));
      await this.audit.record(user, 'plan.override_move', { type: 'order', id: order.id }, { ref: order.ref, from: current ? tripKey(current.vehicleId, current.tripNo) : 'deferred', to: key, reason }, meta, tx);
    });
    await this.refreshSummary(state.date, state.depot);
    const republished = await this.autoRepublish(state.plan!.id, ['published', 'replanned'].includes(state.plan!.status), user, meta);
    await this.notifications.invalidate({ roles: ['dispatcher'] }, ['plans', 'orders']);
    return { ok: true as const, preview, violations: [], republished };
  }

  /** D-04/D-05: defer an order with a reason (store sees the reason after publish). */
  async defer(orderId: string, reasonCode: ReasonCode, reason: string, acknowledgeSecond: boolean, user: SessionUser, meta: AuditMeta) {
    const { order, state } = await this.locate(orderId);
    const current = state.allocation.find((t) => t.orderRefs.includes(order.ref));
    if (current) {
      const st = this.tripStatusOf(state, current.vehicleId, current.tripNo);
      if (st && LOCKED_TRIP.includes(st)) throw conflict('trip_departed', 'The vehicle has left; record the outcome on the delivery instead.');
    }
    if (order.deferredYesterday && !acknowledgeSecond) {
      throw new AppError('second_deferral_ack_required', `${order.outletId} was deferred on the last run. Confirm that it is deferred again.`, HttpStatus.CONFLICT);
    }
    const next = state.allocation.map((t) => ({ ...t, orderRefs: t.orderRefs.filter((r) => r !== order.ref) })).filter((t) => t.orderRefs.length);
    const decided = new Map<string, DecisionInput>([
      [order.ref, { decision: 'deferred', reasonCode, deferralClass: 'choice', explanation: `Deferred by the dispatcher: ${reason}`, storeReason: reason }],
    ]);
    const status = this.nextPlanStatus(state.plan!.status);
    await this.db.transaction(async (tx) => {
      assertTransition('Plan', PLAN_TRANSITIONS, state.plan!.status, status, 'dispatcher');
      await this.store.apply(tx, state, state.plan!.id, next, decided, 'dispatcher');
      if (acknowledgeSecond) {
        await tx.update(decisions).set({ acknowledged: true }).where(and(eq(decisions.planId, state.plan!.id), eq(decisions.orderId, order.id)));
      }
      await tx.update(plans).set({ status, updatedAt: new Date() }).where(eq(plans.id, state.plan!.id));
      await this.audit.record(user, 'plan.override_defer', { type: 'order', id: order.id }, { ref: order.ref, from: current ? tripKey(current.vehicleId, current.tripNo) : null, reasonCode, reason }, meta, tx);
    });
    await this.refreshSummary(state.date, state.depot);
    await this.autoRepublish(state.plan!.id, ['published', 'replanned'].includes(state.plan!.status), user, meta);
    await this.notifications.invalidate({ roles: ['dispatcher'] }, ['plans', 'orders']);
  }

  /** D3: edit the store-facing reason of a deferral before publishing. */
  async setDeferralReason(orderId: string, reason: string, user: SessionUser, meta: AuditMeta) {
    const { order, state } = await this.locate(orderId);
    const res = await this.db
      .update(decisions)
      .set({ storeReason: reason, acknowledged: true, updatedAt: new Date() })
      .where(and(eq(decisions.planId, state.plan!.id), eq(decisions.orderId, order.id), eq(decisions.decision, 'deferred')))
      .returning({ id: decisions.orderId });
    if (!res.length) throw notFound('This order is not deferred.');
    await this.audit.record(user, 'plan.deferral_reason', { type: 'order', id: order.id }, { ref: order.ref, reason }, meta);
  }

  private async refreshSummary(date: string, depot: Depot) {
    const state = await this.state(date, depot);
    if (!state.plan) return;
    const decided = new Map<string, DecisionInput>();
    const rows = await this.db.select().from(decisions).where(eq(decisions.planId, state.plan.id));
    const byId = new Map([...state.orders.values()].map((o) => [o.id, o.ref]));
    for (const d of rows) {
      const ref = byId.get(d.orderId);
      if (ref) decided.set(ref, { decision: d.decision, reasonCode: d.reasonCode ?? undefined, deferralClass: d.deferralClass ?? undefined });
    }
    const prev = (state.plan.summary ?? {}) as Partial<PlanSummary>;
    const summary = this.summarise(state, state.allocation, decided, state.plan.engine, prev.engineStatus ?? 'n/a', prev.solveMs ?? 0);
    await this.db.update(plans).set({ summary: summary as never }).where(eq(plans.id, state.plan.id));
  }

  /**
   * Changes to a published plan are republished at once as version N+1 (Designathon D2 "edit
   * published plan"), so loaders and drivers are never working from an unannounced change.
   * A pending second-deferral acknowledgement leaves the plan in `replanned` for a manual republish.
   */
  private async autoRepublish(planId: string, wasPublished: boolean, user: SessionUser | null, meta: AuditMeta): Promise<number | null> {
    if (!wasPublished || !user) return null;
    try {
      return (await this.publish(planId, false, user, meta)).version;
    } catch (e) {
      if (e instanceof AppError && (e.code === 'second_deferral_ack_required' || e.code === 'nothing_to_publish')) return null;
      throw e;
    }
  }

  // ---------------------------------------------------------------- publish
  /** D-06: publish (or republish) the plan as version N and notify every affected role. */
  async publish(planId: string, acknowledgeSecond: boolean, user: SessionUser, meta: AuditMeta) {
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, planId));
    if (!plan) throw notFound('Plan not found');
    if (!['generated', 'edited', 'replanned'].includes(plan.status)) {
      throw conflict('nothing_to_publish', plan.status === 'published' ? 'This plan is already published. Make a change first.' : 'This plan cannot be published.');
    }
    const state = await this.state(plan.runDate, plan.depot);
    const decs = await this.db.select().from(decisions).where(eq(decisions.planId, planId));
    const pendingSecond = decs.filter((d) => d.decision === 'deferred' && d.secondConsecutive && !d.acknowledged);
    if (pendingSecond.length && !acknowledgeSecond) {
      const refs = pendingSecond.map((d) => [...state.orders.values()].find((o) => o.id === d.orderId)?.ref).filter(Boolean);
      throw new AppError('second_deferral_ack_required', `${refs.join(', ')} ${refs.length === 1 ? 'was' : 'were'} deferred on the last run too. Acknowledge before publishing.`, HttpStatus.CONFLICT, { refs });
    }
    const missingReason = decs.filter((d) => d.decision === 'deferred' && !d.storeReason?.trim());
    if (missingReason.length) throw conflict('reason_required', 'Every deferral needs a reason before you publish.');

    const version = (plan.publishedVersion ?? 0) + 1;
    const snapshot = Object.fromEntries(state.allocation.map((t) => [tripKey(t.vehicleId, t.tripNo), t.orderRefs]));
    const [prev] = await this.db.select().from(planVersions).where(eq(planVersions.planId, planId)).orderBy(desc(planVersions.version)).limit(1);
    const diff = prev ? this.diff(prev.snapshot, snapshot, state) : [];
    const nextRun = await this.store.nextOperatingDay(plan.runDate);
    const deferredRows = decs.filter((d) => d.decision === 'deferred');
    const now = new Date();

    await this.db.transaction(async (tx) => {
      assertTransition('Plan', PLAN_TRANSITIONS, plan.status, 'published', 'dispatcher');
      await tx.update(plans).set({ status: 'published', publishedVersion: version, version, publishedAt: now, updatedAt: now }).where(eq(plans.id, planId));
      await tx.insert(planVersions).values({ planId, version, snapshot, diff, publishedBy: user.id });
      const servedIds = [...state.orders.values()].filter((o) => o.status === 'planned').map((o) => o.id);
      if (servedIds.length) await tx.update(orders).set({ status: 'published', updatedAt: now }).where(inArray(orders.id, servedIds));
      await tx.update(decisions).set({ acknowledged: true }).where(and(eq(decisions.planId, planId), eq(decisions.secondConsecutive, true)));
      if (pendingSecond.length) await this.exceptionsSvc.resolveOpen('second_deferral', { runDate: plan.runDate }, 'Acknowledged by the dispatcher at publish', tx);
      await tx.update(decisions).set({ notifiedAt: now }).where(and(eq(decisions.planId, planId), eq(decisions.decision, 'deferred')));
      // Deferred orders join the next operating day's queue with priority (F6 deferred → confirmed).
      for (const d of deferredRows) {
        const o = [...state.orders.values()].find((x) => x.id === d.orderId);
        if (!o) continue;
        const [existing] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.carriedFromId, o.id));
        if (existing) continue;
        const base = o.ref.replace(/-C\d+$/, '');
        const n = (o.ref.match(/-C(\d+)$/)?.[1] ? Number(o.ref.match(/-C(\d+)$/)![1]) : 0) + 1;
        await tx.insert(orders).values({
          ref: `${base}-C${n}`,
          outletId: o.outletId,
          brand: o.brand,
          temp: o.temp,
          units: o.units,
          weightKg: o.weightKg,
          volumeM3: o.volumeM3,
          runDate: nextRun,
          status: 'confirmed',
          source: o.source,
          placedBy: o.placedBy,
          deferredYesterday: true,
          daysSinceLastServed: Math.min(30, o.daysSinceLastServed + 1),
          carriedFromId: o.id,
          confirmedAt: now,
        });
      }
      // A carried copy whose original is now served again is withdrawn.
      const servedNow = [...state.orders.values()].filter((o) => decs.find((d) => d.orderId === o.id)?.decision === 'served').map((o) => o.id);
      if (servedNow.length) {
        await tx.update(orders).set({ status: 'cancelled', updatedAt: now }).where(and(inArray(orders.carriedFromId, servedNow), eq(orders.status, 'confirmed')));
      }
      await this.audit.record(user, version === 1 ? 'plan.publish' : 'plan.republish', { type: 'plan', id: planId }, { version, changes: diff.length, deferred: deferredRows.length }, meta, tx);
    });

    await this.notifyPublished(plan.runDate, plan.depot, version, diff, nextRun);
    await this.notifications.invalidate({ roles: ['dispatcher'], depots: [{ role: 'loader', depot: plan.depot }] }, ['plans', 'orders', 'live', 'loads']);
    return { version, changes: diff.length };
  }

  private diff(prev: Record<string, string[]>, next: Record<string, string[]>, state: PlanningState): DiffEntry[] {
    const where = (snap: Record<string, string[]>) => {
      const m = new Map<string, string>();
      for (const [k, refs] of Object.entries(snap)) for (const r of refs) m.set(r, k);
      return m;
    };
    const a = where(prev);
    const b = where(next);
    const out: DiffEntry[] = [];
    for (const [ref, from] of a) {
      const to = b.get(ref);
      const outletId = state.orders.get(ref)?.outletId ?? '';
      if (!to) out.push({ ref, outletId, change: state.orders.get(ref)?.status === 'deferred' ? 'deferred' : 'removed', from });
      else if (to !== from) out.push({ ref, outletId, change: 'moved', from, to });
    }
    for (const [ref, to] of b) if (!a.has(ref)) out.push({ ref, outletId: state.orders.get(ref)?.outletId ?? '', change: 'added', to });
    return out;
  }

  private async notifyPublished(date: string, depot: Depot, version: number, diff: DiffEntry[], nextRun: string) {
    const state = await this.state(date, depot);
    const time = minToHhmm((await this.clock.parts()).minute);
    const tripsByVehicle = new Map<string, typeof state.liveTrips>();
    for (const t of state.liveTrips) tripsByVehicle.set(t.vehicleId, [...(tripsByVehicle.get(t.vehicleId) ?? []), t]);
    const describe = (d: DiffEntry) =>
      d.change === 'moved' ? `${d.outletId} (${d.ref}) moved from ${d.from} to ${d.to}` : d.change === 'added' ? `${d.outletId} (${d.ref}) added to ${d.to}` : `${d.outletId} (${d.ref}) taken off ${d.from}`;

    if (version === 1) {
      await this.notifications.notify({
        type: 'plan.published',
        severity: 'info',
        title: `Plan published for ${formatDayMonth(date)}`,
        body: `${state.liveTrips.length} trips to load at ${depot}. Load each trip last stop first.`,
        link: '/loader',
        to: { depots: [{ role: 'loader', depot }] },
      });
      for (const [vehicleId, list] of tripsByVehicle) {
        const first = [...list].sort((a, b) => a.tripNo - b.tripNo)[0]!;
        await this.notifications.notify({
          type: 'plan.published',
          severity: 'info',
          title: `Your run for ${formatDayMonth(date)} is ready`,
          body: `${list.length} trip${list.length > 1 ? 's' : ''} on ${vehicleId}. ${tripKey(vehicleId, first.tripNo)} departs ${minToHhmm(first.departMin)}.`,
          link: '/driver',
          to: { vehicleIds: [vehicleId] },
        });
      }
    } else if (diff.length) {
      const body = diff.slice(0, 3).map(describe).join('; ');
      await this.notifications.notify({
        type: 'plan.changed',
        severity: 'warning',
        title: `Plan changed at ${time}`,
        body,
        link: '/loader',
        to: { depots: [{ role: 'loader', depot }] },
      });
      const vehicles = new Set(diff.flatMap((d) => [d.from, d.to].filter(Boolean).map((k) => k!.split('-T')[0]!)));
      for (const vehicleId of vehicles) {
        const mine = diff.filter((d) => d.from?.startsWith(`${vehicleId}-`) || d.to?.startsWith(`${vehicleId}-`));
        await this.notifications.notify({
          type: 'plan.changed',
          severity: 'warning',
          title: `Plan changed at ${time}`,
          body: mine.map(describe).join('; '),
          link: '/driver',
          to: { vehicleIds: [vehicleId] },
        });
      }
      await this.exceptionsSvc.raise({
        type: 'plan_changed',
        severity: 'info',
        runDate: date,
        vehicleId: diff[0]!.from?.split('-T')[0] ?? null,
        title: 'Plan changed',
        body: body,
        resolved: true,
      });
    }

    // Store managers: ETA for served orders, deferral notice for deferred ones (S-05, S-06).
    const outletMap = await this.ref.outlets();
    const decs = await this.db
      .select({ d: decisions, o: orders })
      .from(decisions)
      .innerJoin(orders, eq(orders.id, decisions.orderId))
      .where(eq(decisions.planId, state.plan!.id));
    const changedRefs = new Set(diff.map((d) => d.ref));
    const stopByOrder = new Map(state.liveStops.map((s) => [s.orderId, s]));
    for (const { d, o } of decs) {
      if (d.decision === 'deferred') {
        if (version > 1 && !changedRefs.has(o.ref)) continue;
        await this.notifications.notify({
          type: 'order.deferred',
          severity: 'warning',
          title: `Order ${o.ref} was deferred`,
          body: `Reason: ${d.storeReason}. The order goes to the ${formatDayMonth(nextRun)} run.`,
          link: `/store/orders/${o.id}`,
          to: { outletIds: [o.outletId] },
        });
      } else if (version === 1 || changedRefs.has(o.ref)) {
        const s = stopByOrder.get(o.id);
        if (!s) continue;
        await this.notifications.notify({
          type: 'order.scheduled',
          severity: 'info',
          title: `Order ${o.ref} is scheduled`,
          body: `${outletMap.get(o.outletId)?.name ?? o.outletId}: planned arrival ${minToHhmm(s.plannedArrivalMin)} on ${formatDayMonth(date)}.`,
          link: `/store/orders/${o.id}`,
          to: { outletIds: [o.outletId] },
        });
      }
    }
    await this.notifications.invalidate({ outletIds: [...new Set(decs.map((x) => x.o.outletId))] }, ['store-orders']);
    await this.notifications.invalidate({ vehicleIds: [...tripsByVehicle.keys()] }, ['run']);
  }

  // ---------------------------------------------------------------- fleet
  /** D-08/D-09: vehicle availability. Sending a planned vehicle to the workshop re-plans its depot. */
  async setVehicleStatus(vehicleId: string, date: string, status: VehicleDayStatus, note: string | undefined, user: SessionUser, meta: AuditMeta) {
    const vehicle = (await this.ref.vehicles()).get(vehicleId);
    if (!vehicle) throw notFound('Vehicle not found');
    await this.db
      .insert(vehicleDays)
      .values({ vehicleId, date, status, note: note ?? null, updatedBy: user.id })
      .onConflictDoUpdate({ target: [vehicleDays.vehicleId, vehicleDays.date], set: { status, note: note ?? null, updatedBy: user.id, updatedAt: new Date() } });
    await this.audit.record(user, 'fleet.status', { type: 'vehicle', id: vehicleId }, { date, status, note }, meta);
    const affected = await this.db
      .select()
      .from(trips)
      .where(and(eq(trips.runDate, date), eq(trips.vehicleId, vehicleId), inArray(trips.status, ['planned', 'loading', 'ready'])));
    let replanned = false;
    if (status === 'in_workshop' && affected.length) {
      await this.run(date, vehicle.depot, user, meta, `${vehicleId} in workshop`);
      replanned = true;
      await this.exceptionsSvc.raise({
        type: 'vehicle_workshop',
        severity: 'warning',
        runDate: date,
        vehicleId,
        title: 'Vehicle in workshop',
        body: `${vehicleId} is out of service${note ? ` (${note})` : ''}. Its ${affected.length} trip${affected.length > 1 ? 's were' : ' was'} re-planned. Review and republish.`,
      });
      await this.notifications.notify({
        type: 'fleet.workshop',
        severity: 'warning',
        title: `${vehicleId} is in the workshop`,
        body: `Its trips for ${formatDayMonth(date)} are being re-planned. Wait for the updated plan.`,
        link: '/loader',
        to: { depots: [{ role: 'loader', depot: vehicle.depot }], vehicleIds: [vehicleId] },
      });
    }
    await this.notifications.invalidate({ roles: ['dispatcher'] }, ['fleet', 'plans']);
    return { replanned };
  }

  /** Next ORD reference for store-manager orders. */
  async nextOrderRef(tx: Pick<Db, 'execute'>): Promise<string> {
    await tx.execute(sql`select pg_advisory_xact_lock(4242)`);
    const rows = (await tx.execute(sql`select coalesce(max(substring(ref from 4 for 7)::int), 1000000) as n from orders where ref ~ '^ORD[0-9]{7}$'`)).rows as { n: number }[];
    return `ORD${Number(rows[0]!.n) + 1}`;
  }
}
