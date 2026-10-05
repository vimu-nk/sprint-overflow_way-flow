import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  assertTransition,
  formatDayMonth,
  isBeforeCutoff,
  ORDER_TRANSITIONS,
  type StoreHomeDto,
} from '@wayflow/shared';
import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import { AuditService, type AuditMeta } from '../audit/audit.service.js';
import { ClockService } from '../clock/clock.service.js';
import type { SessionUser } from '../common/decorators.js';
import { AppError, conflict, notFound } from '../common/errors.js';
import { DB, type Db } from '../db/drizzle.module.js';
import { attachments, orders, receipts, stops, syncActions, trips } from '../db/schema.js';
import { ExceptionsService } from '../exceptions/exceptions.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PlanningService } from '../planning/planning.service.js';
import { ReferenceService } from '../reference/reference.service.js';
import { ViewsService } from '../views/views.service.js';

const AWAITING_RECEIPT = ['delivered', 'partial'] as const;

@Injectable()
export class StoreService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: ClockService,
    private readonly ref: ReferenceService,
    private readonly views: ViewsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly planning: PlanningService,
    private readonly exceptionsSvc: ExceptionsService,
  ) {}

  /** Object-level scope (SEC-26): a store manager only ever sees their own outlet. */
  private outletOf(user: SessionUser): string {
    if (!user.outletId) throw new AppError('forbidden', 'No outlet is linked to this account.', HttpStatus.FORBIDDEN);
    return user.outletId;
  }

  private async ownOrder(user: SessionUser, id: string) {
    const [o] = await this.db.select().from(orders).where(and(eq(orders.id, id), eq(orders.outletId, this.outletOf(user))));
    if (!o) throw notFound('Order not found');
    return o;
  }

  async home(user: SessionUser): Promise<StoreHomeDto> {
    const outletId = this.outletOf(user);
    const outlet = (await this.ref.outlet(outletId))!;
    const { date } = await this.clock.parts();
    const rows = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.outletId, outletId), or(gte(orders.runDate, addDays(date, -1)), inArray(orders.status, [...AWAITING_RECEIPT, 'disputed']))))
      .orderBy(desc(orders.runDate), orders.ref);
    const dtos = await this.views.orderDtos(rows);
    const tripIds = dtos.map((o) => o.tripId).filter((x): x is string => !!x);
    let updatesDelayed: StoreHomeDto['updatesDelayed'] = null;
    if (tripIds.length) {
      for (const t of await this.db.select().from(trips).where(inArray(trips.id, tripIds))) {
        if (await this.views.isStale(t)) updatesDelayed = { since: (t.lastSignalAt ?? t.departedAt)!.toISOString() };
      }
    }
    const [chilled, ambient] = await Promise.all([this.ref.unitProfile(outlet.brand, 'chilled'), this.ref.unitProfile(outlet.brand, 'ambient')]);
    return {
      outlet: this.views.outlet(outlet),
      clock: await this.clock.dto(),
      unitProfiles: { chilled: outlet.brand === 'Fresh' ? chilled : null, ambient },
      orders: dtos,
      updatesDelayed,
    };
  }

  async list(user: SessionUser) {
    const rows = await this.db.select().from(orders).where(eq(orders.outletId, this.outletOf(user))).orderBy(desc(orders.runDate), orders.ref).limit(100);
    return this.views.orderDtos(rows);
  }

  async get(user: SessionUser, id: string) {
    const [dto] = await this.views.orderDtos([await this.ownOrder(user, id)]);
    return dto!;
  }

  /**
   * S-02/S-03: place an order (Fresh may send chilled and ambient on the same day). The run date
   * comes from the simulation clock and the 16:00 cutoff; nothing about it is trusted from the client.
   */
  async place(user: SessionUser, chilledUnits: number, ambientUnits: number, clientActionId: string | undefined, meta: AuditMeta) {
    const outletId = this.outletOf(user);
    const outlet = (await this.ref.outlet(outletId))!;
    if (outlet.brand !== 'Fresh' && chilledUnits > 0) {
      throw new AppError('chilled_not_allowed', `Waypoint ${outlet.brand} outlets order ambient goods only.`, HttpStatus.BAD_REQUEST);
    }
    if (clientActionId) {
      const [dup] = await this.db.select().from(syncActions).where(and(eq(syncActions.userId, user.id), eq(syncActions.clientActionId, clientActionId)));
      if (dup) return dup.result as { orders: string[]; runDate: string; afterCutoff: boolean };
    }
    const { date, minute } = await this.clock.parts();
    const runDate = await this.clock.runDateFor(date, minute);
    const nextRun = await this.clock.nextRunDate(date);
    const afterCutoff = runDate !== nextRun;
    const lines = [
      { temp: 'chilled' as const, units: chilledUnits },
      { temp: 'ambient' as const, units: ambientUnits },
    ].filter((l) => l.units > 0);
    const created: string[] = [];
    await this.db.transaction(async (tx) => {
      for (const l of lines) {
        const p = await this.ref.unitProfile(outlet.brand, l.temp);
        if (!p) throw new AppError('no_profile', 'No order-size history for this product type.', 422);
        const ref = await this.planning.nextOrderRef(tx);
        const [row] = await tx
          .insert(orders)
          .values({
            ref,
            outletId,
            brand: outlet.brand,
            temp: l.temp,
            units: l.units,
            weightKg: Math.round(l.units * p.kgPerUnit * 10) / 10,
            volumeM3: Math.round(l.units * p.m3PerUnit * 100) / 100,
            runDate,
            status: 'draft',
            source: 'store_manager',
            placedBy: user.id,
            placedAfterCutoff: afterCutoff,
          })
          .returning({ id: orders.id });
        // Draft → confirmed in one step (the design's "Place order" is the confirmation).
        assertTransition('Order', ORDER_TRANSITIONS, 'draft', 'confirmed', 'store_manager');
        await tx.update(orders).set({ status: 'confirmed', confirmedAt: new Date() }).where(eq(orders.id, row!.id));
        created.push(ref);
        await this.audit.record(user, 'order.place', { type: 'order', id: row!.id }, { ref, runDate, units: l.units, temp: l.temp, afterCutoff }, meta, tx);
      }
      const result = { orders: created, runDate, afterCutoff };
      if (clientActionId) {
        await tx.insert(syncActions).values({ userId: user.id, clientActionId, deviceId: 'web', type: 'store.order', status: 'applied', result, createdAtClient: new Date() });
      }
    });
    await this.notifications.notify({
      type: 'order.confirmed',
      severity: 'info',
      title: `Order ${created.join(' and ')} placed`,
      body: `Goes to the ${formatDayMonth(runDate)} run.${afterCutoff ? ' The 16:00 cutoff had passed.' : ''} It shows Scheduled once the plan is published.`,
      link: '/store/deliveries',
      to: { userIds: [user.id] },
    });
    await this.notifications.invalidate({ roles: ['dispatcher'] }, ['orders']);
    return { orders: created, runDate, afterCutoff };
  }

  /** Cancel before the cutoff only (F6 confirmed → cancelled). */
  async cancel(user: SessionUser, id: string, meta: AuditMeta) {
    const o = await this.ownOrder(user, id);
    const { date, minute } = await this.clock.parts();
    if (!isBeforeCutoff(o.runDate, date, minute)) throw conflict('after_cutoff', 'The 16:00 cutoff has passed; this order is locked.');
    assertTransition('Order', ORDER_TRANSITIONS, o.status, 'cancelled', 'store_manager');
    await this.db.update(orders).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(orders.id, o.id));
    await this.audit.record(user, 'order.cancel', { type: 'order', id: o.id }, { ref: o.ref }, meta);
    await this.notifications.invalidate({ roles: ['dispatcher'] }, ['orders']);
  }

  /** S-07: confirm receipt or report a problem (short, damaged, wrong). */
  async receipt(
    user: SessionUser,
    id: string,
    dto: { unitsReceived: number; damagedUnits: number; problem: boolean; note?: string; attachmentId?: string },
    meta: AuditMeta,
  ) {
    const o = await this.ownOrder(user, id);
    if (!AWAITING_RECEIPT.includes(o.status as (typeof AWAITING_RECEIPT)[number])) {
      throw conflict('not_delivered', 'Receipt can be confirmed once the order is delivered.');
    }
    const [stop] = await this.db.select().from(stops).where(and(eq(stops.orderId, o.id), inArray(stops.status, ['delivered', 'partial'])));
    const expected = stop?.deliveredUnits ?? o.units;
    if (dto.unitsReceived > o.units) throw new AppError('too_many_units', `At most ${o.units} units were ordered.`, 400);
    const problem = dto.problem || dto.damagedUnits > 0 || dto.unitsReceived < expected;
    if (problem && !dto.note) throw new AppError('note_required', 'Say what is wrong so the dispatcher can act.', 400);
    if (dto.attachmentId) {
      const [att] = await this.db.select().from(attachments).where(and(eq(attachments.id, dto.attachmentId), eq(attachments.uploadedBy, user.id)));
      if (!att) throw notFound('Photo not found');
    }
    const next = problem ? 'disputed' : 'received';
    const [trip] = stop ? await this.db.select().from(trips).where(eq(trips.id, stop.tripId)) : [];
    await this.db.transaction(async (tx) => {
      assertTransition('Order', ORDER_TRANSITIONS, o.status, next, 'store_manager');
      await tx.insert(receipts).values({ orderId: o.id, unitsReceived: dto.unitsReceived, damagedUnits: dto.damagedUnits, problem, note: dto.note ?? null, createdBy: user.id });
      await tx.update(orders).set({ status: next, updatedAt: new Date() }).where(eq(orders.id, o.id));
      if (dto.attachmentId) await tx.update(attachments).set({ entityType: 'receipt', entityId: o.id }).where(eq(attachments.id, dto.attachmentId));
      if (problem) {
        await this.exceptionsSvc.raise(
          {
            type: 'receipt_issue',
            severity: 'warning',
            runDate: o.runDate,
            orderId: o.id,
            outletId: o.outletId,
            vehicleId: trip?.vehicleId ?? null,
            tripId: trip?.id ?? null,
            title: 'Receipt issue',
            body: `${o.outletId}, order ${o.ref}. ${dto.damagedUnits ? `${dto.damagedUnits} units arrived damaged` : `${dto.unitsReceived} of ${expected} units received`} (${dto.note}).${dto.attachmentId ? ' Photo attached.' : ''}`,
            raisedBy: user.id,
          },
          tx,
        );
      }
      await this.audit.record(user, problem ? 'receipt.issue' : 'receipt.confirm', { type: 'order', id: o.id }, { ref: o.ref, ...dto }, meta, tx);
    });
    if (problem) {
      const depot = await this.ref.depotOf(o.outletId);
      await this.notifications.notify({
        type: 'receipt.issue',
        severity: 'warning',
        title: `Receipt issue on ${o.ref}`,
        body: `${o.outletId}: ${dto.damagedUnits ? `${dto.damagedUnits} units damaged` : `${dto.unitsReceived} units received`} (${dto.note}).`,
        link: '/dispatcher/live',
        to: { roles: ['dispatcher'], ...(dto.unitsReceived < expected && depot ? { depots: [{ role: 'loader' as const, depot }] } : {}) },
      });
    }
    await this.notifications.invalidate({ roles: ['dispatcher'] }, ['live', 'orders', 'exceptions']);
    return { status: next };
  }
}
