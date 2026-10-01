import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  assertTransition,
  FAILURE_REASON_LABEL,
  type FieldAction,
  formatDayMonth,
  minToHhmm,
  ORDER_TRANSITIONS,
  colomboParts,
  PROBLEM_KIND_LABEL,
  STOP_TRANSITIONS,
  type SyncBatch,
  type SyncResult,
  TRIP_TRANSITIONS,
  TransitionError,
} from '@wayflow/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { AuditService, type AuditMeta } from '../audit/audit.service.js';
import { ClockService } from '../clock/clock.service.js';
import type { SessionUser } from '../common/decorators.js';
import { AppError } from '../common/errors.js';
import { DB, type Db } from '../db/drizzle.module.js';
import { loadFlags, orders, plans, problemReports, stops, syncActions, trips } from '../db/schema.js';
import { ExceptionsService } from '../exceptions/exceptions.service.js';
import { NotificationsService, type NotifyInput } from '../notifications/notifications.service.js';
import type { Tx } from '../planning/plan-store.js';
import { ReferenceService } from '../reference/reference.service.js';

/** Rejected with a reason the device can show. Not an HTTP error: the batch carries on. */
class Reject extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

/** Outcome of one action. `conflict` = applied (the field fact is kept) but clashed with a plan change. */
interface Applied {
  message: string;
  conflict?: boolean;
}

const SKEW_PAST_MS = 12 * 3600_000;
const SKEW_FUTURE_MS = 5 * 60_000;

type TripRow = typeof trips.$inferSelect;

/**
 * POST /sync/batch (specs/08 §3): applies queued loader and driver actions in order, one
 * transaction each. Idempotent per (user, clientActionId); every action is re-authorised and
 * re-validated now (SEC-75); field facts are never discarded.
 */
@Injectable()
export class SyncService {
  private readonly log = new Logger('Sync');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly exceptionsSvc: ExceptionsService,
    private readonly ref: ReferenceService,
  ) {}

  async process(user: SessionUser, batch: SyncBatch, meta: AuditMeta): Promise<SyncResult[]> {
    if (user.role !== 'driver' && user.role !== 'loader') {
      throw new AppError('forbidden', 'Only loaders and drivers sync field actions.', HttpStatus.FORBIDDEN);
    }
    const results: SyncResult[] = [];
    const failedTrips = new Set<string>();
    const after: NotifyInput[] = [];
    const simOffset = (await this.clock.now()).getTime() - Date.now();

    for (const item of batch.actions) {
      const [done] = await this.db
        .select()
        .from(syncActions)
        .where(and(eq(syncActions.userId, user.id), eq(syncActions.clientActionId, item.clientActionId)));
      if (done) {
        results.push({ clientActionId: item.clientActionId, status: 'duplicate', message: (done.result as { message?: string } | null)?.message });
        continue;
      }
      const a = item.action;
      const tripKey = 'tripId' in a ? a.tripId : null;
      const clientAt = new Date(item.createdAtClient);
      const skew = clientAt.getTime() < Date.now() - SKEW_PAST_MS || clientAt.getTime() > Date.now() + SKEW_FUTURE_MS;
      // Event time on the simulated clock; implausible client clocks fall back to receive time.
      const eventAt = new Date((skew ? Date.now() : clientAt.getTime()) + simOffset);
      let result: SyncResult;
      try {
        if (tripKey && failedTrips.has(tripKey)) throw new Reject('dependency_failed', 'An earlier action for this trip was rejected.');
        const applied = await this.db.transaction(async (tx) => {
          const r = await this.apply(tx, user, a, eventAt, item.clientActionId, after);
          await tx.insert(syncActions).values({
            userId: user.id,
            clientActionId: item.clientActionId,
            deviceId: batch.deviceId,
            type: a.type,
            status: r.conflict ? 'conflict' : 'applied',
            result: { message: r.message },
            createdAtClient: clientAt,
            clockSkewFlag: skew,
          });
          await this.audit.record(user, `field.${a.type}`, { type: 'sync', id: item.clientActionId }, { ...a, skew, conflict: !!r.conflict }, meta, tx);
          return r;
        });
        result = applied.conflict
          ? { clientActionId: item.clientActionId, status: 'conflict', reason: 'plan_changed', message: applied.message }
          : { clientActionId: item.clientActionId, status: 'applied', message: applied.message };
      } catch (e) {
        if (e instanceof Reject || e instanceof TransitionError) {
          const reason = e instanceof Reject ? e.reason : 'illegal_transition';
          const message = e instanceof Reject ? e.message : 'This step is no longer possible for this trip.';
          result = { clientActionId: item.clientActionId, status: 'rejected', reason, message };
          if (tripKey) failedTrips.add(tripKey);
          await this.audit.record(user, 'field.rejected', { type: 'sync', id: item.clientActionId }, { type: a.type, reason }, meta);
        } else {
          this.log.error({ err: e }, 'sync action failed');
          throw e;
        }
      }
      results.push(result);
    }
    for (const n of after) await this.notifications.notify(n).catch((err) => this.log.warn({ err }, 'notify failed'));
    await this.notifications.invalidate({ roles: ['dispatcher'] }, ['live', 'plans', 'orders', 'exceptions']);
    return results;
  }

  // ---------------------------------------------------------------- scoping
  private async tripFor(tx: Tx, user: SessionUser, tripId: string): Promise<TripRow> {
    const [row] = await tx.select({ t: trips, depot: plans.depot, published: plans.publishedVersion }).from(trips).innerJoin(plans, eq(plans.id, trips.planId)).where(eq(trips.id, tripId));
    const ok = row && row.published !== null && (user.role === 'loader' ? row.depot === user.depot : row.t.vehicleId === user.vehicleId);
    if (!ok) throw new Reject('not_found', 'Trip not found.');
    return row.t;
  }

  private async stopFor(tx: Tx, user: SessionUser, stopId: string) {
    const [s] = await tx.select().from(stops).where(eq(stops.id, stopId));
    if (!s) throw new Reject('not_found', 'Stop not found.');
    const trip = await this.tripFor(tx, user, s.tripId);
    const [order] = await tx.select().from(orders).where(eq(orders.id, s.orderId));
    return { stop: s, trip, order: order! };
  }

  private requireRole(user: SessionUser, role: 'loader' | 'driver') {
    if (user.role !== role) throw new Reject('forbidden', `Only the ${role} can do this.`);
  }

  /** Any sync from the vehicle means it has signal now (simulated server time). */
  private async signal(tx: Tx, trip: TripRow) {
    const at = await this.clock.now();
    await tx.update(trips).set({ lastSignalAt: at }).where(eq(trips.id, trip.id));
    await this.exceptionsSvc.resolveOpen('vehicle_offline', { tripId: trip.id }, `Signal back at ${minToHhmm(colomboParts(at).minute)}`, tx);
  }

  // ---------------------------------------------------------------- actions
  private async apply(tx: Tx, user: SessionUser, a: FieldAction, at: Date, clientActionId: string, after: NotifyInput[]): Promise<Applied> {
    switch (a.type) {
      case 'load.check': {
        this.requireRole(user, 'loader');
        const { stop, trip } = await this.stopFor(tx, user, a.stopId);
        if (stop.tripId !== a.tripId) throw new Reject('stop_moved', 'This order is no longer on this trip.');
        if (stop.status === 'skipped') return { message: 'Plan changed: this order moved to another trip. Do not load it.', conflict: true };
        if (trip.status === 'departed' || trip.status === 'completed') throw new Reject('departed', 'The vehicle has left the dock.');
        if (trip.status === 'planned') {
          assertTransition('Trip', TRIP_TRANSITIONS, 'planned', 'loading', 'loader');
          await tx.update(trips).set({ status: 'loading', loadingStartedAt: at }).where(eq(trips.id, trip.id));
        }
        if (trip.status === 'ready' && !a.loaded) {
          await tx.update(trips).set({ status: 'loading', readyAt: null }).where(eq(trips.id, trip.id));
        }
        await tx.update(stops).set({ loaded: a.loaded, loadedAt: a.loaded ? at : null }).where(eq(stops.id, stop.id));
        return { message: a.loaded ? 'Marked loaded' : 'Unticked' };
      }

      case 'load.flag': {
        this.requireRole(user, 'loader');
        const { stop, trip, order } = await this.stopFor(tx, user, a.stopId);
        if (a.unitsAffected > order.units) throw new Reject('too_many_units', `The order has ${order.units} units.`);
        const afterDeparture = trip.status === 'departed' || trip.status === 'completed';
        await tx.insert(loadFlags).values({ id: clientActionId, tripId: trip.id, stopId: stop.id, kind: a.kind, unitsAffected: a.unitsAffected, note: a.note ?? null, afterDeparture, createdBy: user.id, createdAtClient: at });
        if (trip.status === 'planned') await tx.update(trips).set({ status: 'loading', loadingStartedAt: at }).where(eq(trips.id, trip.id));
        const what = a.kind === 'shortfall' ? 'missing' : 'damaged';
        const body = `${a.unitsAffected} of ${order.units} ${order.temp} units ${what} for ${order.outletId} (${order.ref}) at the ${trip.vehicleId} dock.${a.note ? ` ${a.note}` : ''}`;
        await this.exceptionsSvc.raise(
          {
            type: a.kind === 'shortfall' ? 'shortfall' : 'damaged_load',
            severity: 'critical',
            runDate: trip.runDate,
            vehicleId: trip.vehicleId,
            tripId: trip.id,
            orderId: order.id,
            outletId: order.outletId,
            title: a.kind === 'shortfall' ? 'Loading shortfall' : 'Damaged at loading',
            body: afterDeparture ? `${body} Raised after departure.` : body,
            raisedBy: user.id,
          },
          tx,
        );
        after.push(
          { type: 'load.flag', severity: 'critical', title: `${a.kind === 'shortfall' ? 'Shortfall' : 'Damage'} on ${trip.vehicleId}-T${trip.tripNo}`, body, link: '/dispatcher/live', to: { roles: ['dispatcher'] } },
          { type: 'load.flag', severity: 'warning', title: `${order.ref}: ${a.unitsAffected} units ${what}`, body: `${order.units - a.unitsAffected} units go out to ${order.outletId}.`, link: '/driver', to: { vehicleIds: [trip.vehicleId] } },
          { type: 'load.flag', severity: 'warning', title: `${order.ref} will arrive short`, body: `${a.unitsAffected} of ${order.units} units are ${what} at the depot. ${order.units - a.unitsAffected} units are on the way. The dispatcher has been told.`, link: '/store/deliveries', to: { outletIds: [order.outletId] } },
        );
        return { message: `Reported. ${order.units - a.unitsAffected} units go out.` };
      }

      case 'load.ready': {
        this.requireRole(user, 'loader');
        const trip = await this.tripFor(tx, user, a.tripId);
        if (trip.status === 'ready') return { message: 'Already marked loaded' };
        const tripStops = await tx.select().from(stops).where(and(eq(stops.tripId, trip.id), ne(stops.status, 'skipped')));
        const flagged = new Set((await tx.select({ stopId: loadFlags.stopId }).from(loadFlags).where(eq(loadFlags.tripId, trip.id))).map((f) => f.stopId));
        const missing = tripStops.filter((s) => !s.loaded && !flagged.has(s.id));
        if (missing.length) throw new Reject('not_all_loaded', `Tick or flag every order first (${missing.length} left).`);
        assertTransition('Trip', TRIP_TRANSITIONS, trip.status, 'ready', 'loader');
        await tx.update(trips).set({ status: 'ready', readyAt: at }).where(eq(trips.id, trip.id));
        for (const s of tripStops) {
          const [o] = await tx.select().from(orders).where(eq(orders.id, s.orderId));
          if (o?.status === 'published') {
            assertTransition('Order', ORDER_TRANSITIONS, 'published', 'loaded', 'loader');
            await tx.update(orders).set({ status: 'loaded', updatedAt: new Date() }).where(eq(orders.id, o.id));
          }
        }
        after.push(
          { type: 'trip.ready', severity: 'info', title: `${trip.vehicleId}-T${trip.tripNo} is loaded`, body: `You can start the trip. Departure ${minToHhmm(trip.departMin)}.`, link: '/driver', to: { vehicleIds: [trip.vehicleId] } },
          { type: 'trip.ready', severity: 'info', title: `${trip.vehicleId}-T${trip.tripNo} loaded and ready`, body: `${tripStops.length} orders on board${flagged.size ? `, ${flagged.size} flagged` : ''}.`, link: '/dispatcher/live', to: { roles: ['dispatcher'] } },
        );
        return { message: 'Vehicle loaded and ready' };
      }

      case 'trip.start': {
        this.requireRole(user, 'driver');
        const trip = await this.tripFor(tx, user, a.tripId);
        if (trip.status === 'departed') return { message: 'Already started' };
        if (trip.status !== 'ready') throw new Reject('not_ready', 'The loader has not confirmed this vehicle is loaded.');
        const earlier = await tx.select().from(trips).where(and(eq(trips.vehicleId, trip.vehicleId), eq(trips.runDate, trip.runDate), ne(trips.status, 'cancelled')));
        if (earlier.some((t) => t.tripNo < trip.tripNo && t.status !== 'completed')) throw new Reject('previous_trip_open', 'Finish trip 1 before starting trip 2.');
        assertTransition('Trip', TRIP_TRANSITIONS, 'ready', 'departed', 'driver');
        await tx.update(trips).set({ status: 'departed', departedAt: at, lastSignalAt: at }).where(eq(trips.id, trip.id));
        const tripStops = await tx.select().from(stops).where(and(eq(stops.tripId, trip.id), ne(stops.status, 'skipped')));
        const ords = tripStops.length ? await tx.select().from(orders).where(inArray(orders.id, tripStops.map((s) => s.orderId))) : [];
        for (const o of ords) {
          if (o.status === 'loaded') {
            assertTransition('Order', ORDER_TRANSITIONS, 'loaded', 'departed', 'driver');
            await tx.update(orders).set({ status: 'departed', updatedAt: new Date() }).where(eq(orders.id, o.id));
          }
        }
        after.push({ type: 'trip.departed', severity: 'info', title: `${trip.vehicleId}-T${trip.tripNo} departed`, body: `${trip.brand}, ${trip.district}. ${tripStops.length} stops.`, link: '/dispatcher/live', to: { roles: ['dispatcher'] } });
        for (const o of ords) {
          const s = tripStops.find((x) => x.orderId === o.id)!;
          after.push({ type: 'order.departed', severity: 'info', title: `${o.ref} is on the way`, body: `Planned arrival ${minToHhmm(s.plannedArrivalMin)} on ${formatDayMonth(trip.runDate)}.`, link: `/store/orders/${o.id}`, to: { outletIds: [o.outletId] } });
        }
        return { message: 'Trip started' };
      }

      case 'stop.arrive': {
        this.requireRole(user, 'driver');
        const { stop, trip } = await this.stopFor(tx, user, a.stopId);
        if (trip.status !== 'departed') throw new Reject('not_departed', 'Start the trip first.');
        if (stop.status === 'pending') {
          assertTransition('Stop', STOP_TRANSITIONS, 'pending', 'arrived', 'driver');
          await tx.update(stops).set({ status: 'arrived', arrivedAt: at }).where(eq(stops.id, stop.id));
        }
        await this.signal(tx, trip);
        return { message: 'Arrived' };
      }

      case 'stop.outcome':
        return this.outcome(tx, user, a, at, after);

      case 'problem.report': {
        this.requireRole(user, 'driver');
        const trip = await this.tripFor(tx, user, a.tripId);
        await tx.insert(problemReports).values({ id: clientActionId, tripId: trip.id, kind: a.kind, delayMin: a.delayMin ?? null, note: a.note, createdBy: user.id, createdAtClient: at });
        if (a.delayMin) await tx.update(trips).set({ reportedDelayMin: trip.reportedDelayMin + a.delayMin }).where(eq(trips.id, trip.id));
        await this.signal(tx, trip);
        const label = PROBLEM_KIND_LABEL[a.kind];
        const body = `Driver reported ${label.toLowerCase()}${a.delayMin ? `, about ${a.delayMin} minutes delay` : ''} at ${minToHhmm(colomboParts(at).minute)}: ${a.note}`;
        await this.exceptionsSvc.raise({ type: 'road_problem', severity: 'critical', runDate: trip.runDate, vehicleId: trip.vehicleId, tripId: trip.id, title: a.kind === 'breakdown' ? 'Breakdown' : 'Road problem', body, raisedBy: user.id }, tx);
        const pending = await tx.select({ outletId: orders.outletId }).from(stops).innerJoin(orders, eq(orders.id, stops.orderId)).where(and(eq(stops.tripId, trip.id), eq(stops.status, 'pending')));
        after.push({ type: 'problem.report', severity: 'critical', title: `${trip.vehicleId}: ${label}`, body, link: '/dispatcher/live', to: { roles: ['dispatcher'] } });
        if (pending.length) {
          after.push({ type: 'problem.report', severity: 'warning', title: 'Your delivery may be late', body: `The delivery vehicle reported ${label.toLowerCase()}${a.delayMin ? ` (about ${a.delayMin} min)` : ''}. Arrival times are updated.`, link: '/store/deliveries', to: { outletIds: [...new Set(pending.map((p) => p.outletId))] } });
        }
        return { message: 'Problem reported' };
      }
    }
  }

  private async outcome(tx: Tx, user: SessionUser, a: Extract<FieldAction, { type: 'stop.outcome' }>, at: Date, after: NotifyInput[]): Promise<Applied> {
    this.requireRole(user, 'driver');
    let { stop, trip, order } = await this.stopFor(tx, user, a.stopId);
    if (trip.status !== 'departed' && trip.status !== 'completed') throw new Reject('not_departed', 'Start the trip before recording deliveries.');
    if (a.outcome === 'failed' && !a.failureReason) throw new Reject('reason_required', 'Choose a reason.');
    if (a.outcome === 'partial' && (a.deliveredUnits === undefined || a.deliveredUnits >= order.units)) {
      throw new Reject('units_required', `Enter how many of the ${order.units} units were delivered.`);
    }
    let conflictMessage: string | null = null;
    if (stop.status === 'skipped') {
      // The dispatcher moved this order while the driver was offline. The delivery happened:
      // keep the fact on the order's live stop and flag it for review (specs/08 §4).
      const [live] = await tx.select().from(stops).where(and(eq(stops.orderId, order.id), ne(stops.status, 'skipped')));
      if (!live || live.status !== 'pending') {
        throw new Reject('already_recorded', 'This order was already recorded on another trip.');
      }
      await tx.update(stops).set({ needsReview: true }).where(eq(stops.id, live.id));
      stop = live;
      conflictMessage = 'The plan changed while you were offline. Your delivery was kept and the office will review it.';
      await this.exceptionsSvc.raise({ type: 'sync_conflict', severity: 'warning', runDate: trip.runDate, vehicleId: trip.vehicleId, tripId: trip.id, orderId: order.id, outletId: order.outletId, title: 'Sync conflict', body: `${trip.vehicleId} recorded ${order.ref} as ${a.outcome} while offline, after it was moved to another trip. The delivery was kept; review the plan.`, raisedBy: user.id }, tx);
      after.push({ type: 'sync.conflict', severity: 'warning', title: 'Delivery recorded on a moved order', body: `${order.ref} (${order.outletId}) was delivered by ${trip.vehicleId} after a re-plan. Review the plan.`, link: '/dispatcher/live', to: { roles: ['dispatcher'] } });
    } else if (['delivered', 'partial', 'failed'].includes(stop.status)) {
      return { message: 'Already recorded' };
    }
    assertTransition('Stop', STOP_TRANSITIONS, stop.status, a.outcome, 'driver');
    const delivered = a.outcome === 'delivered' ? order.units : a.outcome === 'partial' ? a.deliveredUnits! : 0;
    await tx
      .update(stops)
      .set({
        status: a.outcome,
        completedAt: at,
        completedAtClient: at,
        arrivedAt: stop.arrivedAt ?? at,
        deliveredUnits: delivered,
        failureReason: a.outcome === 'failed' ? a.failureReason! : null,
        shortNote: a.shortNote ?? null,
        recipientName: a.recipientName ?? null,
        geoLat: a.geo?.lat ?? null,
        geoLng: a.geo?.lng ?? null,
      })
      .where(eq(stops.id, stop.id));
    if (order.status === 'departed' || order.status === 'loaded' || order.status === 'published') {
      // A conflicting delivery may arrive before the new trip departs; walk the order forward.
      let st = order.status;
      for (const [from, to] of [['published', 'loaded'], ['loaded', 'departed']] as const) {
        if (st === from) {
          await tx.update(orders).set({ status: to }).where(eq(orders.id, order.id));
          st = to;
        }
      }
      assertTransition('Order', ORDER_TRANSITIONS, 'departed', a.outcome, 'driver');
      await tx.update(orders).set({ status: a.outcome, deliveredUnits: delivered, updatedAt: new Date() }).where(eq(orders.id, order.id));
    }
    await this.signal(tx, trip);
    // Last stop recorded → trip complete (F7).
    const remaining = await tx.select({ id: stops.id }).from(stops).where(and(eq(stops.tripId, trip.id), inArray(stops.status, ['pending', 'arrived'])));
    if (!remaining.length && trip.status === 'departed') {
      assertTransition('Trip', TRIP_TRANSITIONS, 'departed', 'completed', 'driver');
      await tx.update(trips).set({ status: 'completed', completedAt: at }).where(eq(trips.id, trip.id));
      after.push({ type: 'trip.completed', severity: 'info', title: `${trip.vehicleId}-T${trip.tripNo} completed`, body: `All stops recorded on the ${trip.district} run.`, link: '/dispatcher/live', to: { roles: ['dispatcher'] } });
    }
    const outlet = await this.ref.outlet(order.outletId);
    const time = minToHhmm(colomboParts(at).minute);
    if (a.outcome === 'failed') {
      const reason = FAILURE_REASON_LABEL[a.failureReason!];
      await this.exceptionsSvc.raise({ type: 'failed_delivery', severity: 'warning', runDate: trip.runDate, vehicleId: trip.vehicleId, tripId: trip.id, orderId: order.id, outletId: order.outletId, title: 'Failed delivery', body: `Not delivered at ${time}: ${reason.toLowerCase()}.${a.shortNote ? ` ${a.shortNote}` : ''}`, raisedBy: user.id }, tx);
      after.push(
        { type: 'stop.failed', severity: 'warning', title: `${order.ref} not delivered`, body: `${outlet?.name ?? order.outletId}: ${reason}. Reschedule it from the exception.`, link: '/dispatcher/live', to: { roles: ['dispatcher'] } },
        { type: 'stop.failed', severity: 'warning', title: `${order.ref} was not delivered`, body: `Reason: ${reason}. The dispatcher will reschedule it.`, link: `/store/orders/${order.id}`, to: { outletIds: [order.outletId] } },
      );
    } else {
      after.push({ type: 'stop.delivered', severity: 'info', title: `${order.ref} delivered at ${time}`, body: `${a.outcome === 'partial' ? `${delivered} of ${order.units} units delivered. ` : ''}Confirm what arrived or report a problem.`, link: `/store/orders/${order.id}`, to: { outletIds: [order.outletId] } });
    }
    if (conflictMessage) return { message: conflictMessage, conflict: true };
    return { message: a.outcome === 'failed' ? 'Saved as not delivered' : 'Delivery saved' };
  }
}
