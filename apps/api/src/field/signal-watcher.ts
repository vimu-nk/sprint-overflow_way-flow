import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { colomboParts, minToHhmm } from '@wayflow/shared';
import { and, eq, sql } from 'drizzle-orm';
import { ClockService } from '../clock/clock.service.js';
import { DB, type Db } from '../db/drizzle.module.js';
import { orders, stops, trips } from '../db/schema.js';
import { ExceptionsService } from '../exceptions/exceptions.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { STALE_SIGNAL_MIN } from '../views/views.service.js';

/**
 * Raises "Vehicle offline" when a departed vehicle has been silent for 30 minutes (D4), and
 * tells the affected stores their arrival times now come from the plan (SM2 "Updates delayed").
 * The exception resolves itself on the vehicle's next sync.
 */
@Injectable()
export class SignalWatcher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SignalWatcher');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: ClockService,
    private readonly exceptionsSvc: ExceptionsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.check().catch((e) => this.log.warn({ err: e }, 'signal check failed')), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async check(): Promise<number> {
    const now = await this.clock.now();
    const cutoff = new Date(now.getTime() - STALE_SIGNAL_MIN * 60_000);
    const silent = await this.db
      .select()
      .from(trips)
      .where(and(eq(trips.status, 'departed'), sql`coalesce(${trips.lastSignalAt}, ${trips.departedAt}) < ${cutoff.toISOString()}`));
    let raised = 0;
    for (const t of silent) {
      const since = minToHhmm(colomboParts(t.lastSignalAt ?? t.departedAt ?? now).minute);
      const id = await this.exceptionsSvc.raise({
        type: 'vehicle_offline',
        severity: 'warning',
        runDate: t.runDate,
        vehicleId: t.vehicleId,
        tripId: t.id,
        title: 'Vehicle offline',
        body: `No signal since ${since} on the ${t.district} run. Next stops projected from the plan.`,
        dedupeKey: `offline-${t.id}`,
      });
      if (!id) continue;
      raised++;
      const pending = await this.db
        .select({ outletId: orders.outletId })
        .from(stops)
        .innerJoin(orders, eq(orders.id, stops.orderId))
        .where(and(eq(stops.tripId, t.id), eq(stops.status, 'pending')));
      await this.notifications.notify({ type: 'vehicle.offline', severity: 'warning', title: `${t.vehicleId} has no signal`, body: `No update since ${since} on ${t.vehicleId}-T${t.tripNo}. Stops are projected from the plan.`, link: '/dispatcher', to: { roles: ['dispatcher'] } });
      if (pending.length) {
        await this.notifications.notify({ type: 'updates.delayed', severity: 'info', title: `Updates delayed. Last update ${since}`, body: 'The delivery vehicle has not sent an update. Arrival times come from the plan and may change.', link: '/store/deliveries', to: { outletIds: [...new Set(pending.map((p) => p.outletId))] } });
      }
    }
    if (raised) await this.notifications.invalidate({ roles: ['dispatcher'] }, ['live', 'exceptions']);
    return raised;
  }
}
