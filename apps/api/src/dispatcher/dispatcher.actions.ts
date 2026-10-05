import { Inject, Injectable } from '@nestjs/common';
import { assertTransition, ORDER_TRANSITIONS } from '@wayflow/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService, type AuditMeta } from '../audit/audit.service.js';
import { ClockService } from '../clock/clock.service.js';
import type { SessionUser } from '../common/decorators.js';
import { conflict, notFound } from '../common/errors.js';
import { DB, type Db } from '../db/drizzle.module.js';
import { decisions, exceptions, orders, plans } from '../db/schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PlanStore } from '../planning/plan-store.js';
import { ReferenceService } from '../reference/reference.service.js';

/** Dispatcher follow-up actions on incidents (F9). */
@Injectable()
export class DispatcherActions {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly store: PlanStore,
    private readonly ref: ReferenceService,
    private readonly clock: ClockService,
  ) {}

  async resolveException(id: string, resolution: string, user: SessionUser, meta: AuditMeta) {
    const [ex] = await this.db.select().from(exceptions).where(eq(exceptions.id, id));
    if (!ex) throw notFound('Exception not found');
    if (ex.resolvedAt) throw conflict('already_resolved', 'This exception is already resolved.');
    await this.db.transaction(async (tx) => {
      await tx.update(exceptions).set({ resolvedAt: await this.clock.now(), resolvedBy: user.id, resolution }).where(eq(exceptions.id, id));
      // A resolved receipt dispute closes the order (F6 disputed → received).
      if (ex.type === 'receipt_issue' && ex.orderId) {
        const [o] = await tx.select().from(orders).where(eq(orders.id, ex.orderId));
        if (o?.status === 'disputed') {
          assertTransition('Order', ORDER_TRANSITIONS, 'disputed', 'received', 'dispatcher');
          await tx.update(orders).set({ status: 'received', updatedAt: new Date() }).where(eq(orders.id, o.id));
        }
      }
      await this.audit.record(user, 'exception.resolve', { type: 'exception', id }, { code: ex.code, resolution }, meta, tx);
    });
    if (ex.outletId && ex.type === 'receipt_issue') {
      await this.notifications.notify({
        type: 'issue.resolved',
        severity: 'info',
        title: 'Your reported problem was resolved',
        body: resolution,
        link: ex.orderId ? `/store/orders/${ex.orderId}` : '/store',
        to: { outletIds: [ex.outletId] },
      });
    }
    await this.notifications.invalidate({ roles: ['dispatcher'] }, ['live', 'exceptions']);
  }

  /** F6 failed → deferred: the order is re-queued for the next operating day. */
  async rescheduleFailed(orderId: string, reason: string, user: SessionUser, meta: AuditMeta) {
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId));
    if (!o) throw notFound('Order not found');
    if (o.status !== 'failed') throw conflict('not_failed', 'Only an order that was not delivered can be rescheduled.');
    const depot = await this.ref.depotOf(o.outletId);
    const [plan] = await this.db.select().from(plans).where(and(eq(plans.runDate, o.runDate), eq(plans.depot, depot!)));
    const nextRun = await this.store.nextOperatingDay(o.runDate);
    await this.db.transaction(async (tx) => {
      assertTransition('Order', ORDER_TRANSITIONS, 'failed', 'deferred', 'dispatcher');
      await tx.update(orders).set({ status: 'deferred', updatedAt: new Date() }).where(eq(orders.id, o.id));
      if (plan) {
        await tx
          .insert(decisions)
          .values({ planId: plan.id, orderId: o.id, decision: 'deferred', reasonCode: 'DISPATCHER_OVERRIDE', deferralClass: 'choice', explanation: `Not delivered; rescheduled: ${reason}`, storeReason: reason, notifiedAt: new Date() })
          .onConflictDoUpdate({
            target: [decisions.planId, decisions.orderId],
            set: { decision: 'deferred', reasonCode: 'DISPATCHER_OVERRIDE', explanation: `Not delivered; rescheduled: ${reason}`, storeReason: reason, notifiedAt: new Date() },
          });
      }
      await tx.insert(orders).values({
        ref: `${o.ref.replace(/-C\d+$/, '')}-C1`,
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
        daysSinceLastServed: o.daysSinceLastServed + 1,
        carriedFromId: o.id,
        confirmedAt: new Date(),
      }).onConflictDoNothing();
      await this.audit.record(user, 'order.reschedule', { type: 'order', id: o.id }, { ref: o.ref, nextRun, reason }, meta, tx);
    });
    await this.notifications.notify({
      type: 'order.deferred',
      severity: 'warning',
      title: `Order ${o.ref} rescheduled`,
      body: `Reason: ${reason}. It goes on the next run.`,
      link: `/store/orders/${o.id}`,
      to: { outletIds: [o.outletId] },
    });
  }
}
