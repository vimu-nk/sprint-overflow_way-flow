import { Inject, Injectable } from '@nestjs/common';
import type { ExceptionType, Severity } from '@wayflow/shared';
import { and, eq, isNull, like, sql, type SQL } from 'drizzle-orm';
import { ClockService } from '../clock/clock.service.js';
import { DB, type Db } from '../db/drizzle.module.js';
import { exceptions } from '../db/schema.js';
import type { Tx } from '../planning/plan-store.js';

export interface RaiseInput {
  type: ExceptionType;
  severity: Severity;
  runDate: string;
  vehicleId?: string | null;
  tripId?: string | null;
  orderId?: string | null;
  outletId?: string | null;
  title: string;
  body: string;
  raisedBy?: string | null;
  /** Informational entries (e.g. "Plan changed") are stored already resolved. */
  resolved?: boolean;
  /** Skip if an open exception of the same type already exists for this order/trip. */
  dedupeKey?: string;
}

/** The dispatcher's exception queue (D-07): shortfalls, offline vehicles, receipt issues, … */
@Injectable()
export class ExceptionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: ClockService,
  ) {}

  /** Creates EX-MMDD-NN. Returns the new id, or null when deduplicated. */
  async raise(input: RaiseInput, tx: Db | Tx = this.db): Promise<string | null> {
    if (input.dedupeKey) {
      const conds: SQL[] = [eq(exceptions.type, input.type), isNull(exceptions.resolvedAt)];
      if (input.orderId) conds.push(eq(exceptions.orderId, input.orderId));
      if (input.tripId) conds.push(eq(exceptions.tripId, input.tripId));
      const [dup] = await tx.select({ id: exceptions.id }).from(exceptions).where(and(...conds)).limit(1);
      if (dup) return null;
    }
    await tx.execute(sql`select pg_advisory_xact_lock(4343)`);
    const prefix = `EX-${input.runDate.slice(5, 7)}${input.runDate.slice(8, 10)}-`;
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(exceptions)
      .where(like(exceptions.code, `${prefix}%`));
    const code = `${prefix}${String((row?.n ?? 0) + 1).padStart(2, '0')}`;
    // Business times follow the simulation clock so the live board reads consistently.
    const now = await this.clock.now();
    const [created] = await tx
      .insert(exceptions)
      .values({
        code,
        type: input.type,
        severity: input.severity,
        runDate: input.runDate,
        vehicleId: input.vehicleId ?? null,
        tripId: input.tripId ?? null,
        orderId: input.orderId ?? null,
        outletId: input.outletId ?? null,
        title: input.title,
        body: input.body,
        raisedBy: input.raisedBy ?? null,
        raisedAt: now,
        resolvedAt: input.resolved ? now : null,
        resolution: input.resolved ? 'No action needed' : null,
      })
      .returning({ id: exceptions.id });
    return created!.id;
  }

  async resolveOpen(type: ExceptionType, filter: { tripId?: string; vehicleId?: string; runDate?: string }, resolution: string, tx: Db | Tx = this.db) {
    const conds: SQL[] = [eq(exceptions.type, type), isNull(exceptions.resolvedAt)];
    if (filter.tripId) conds.push(eq(exceptions.tripId, filter.tripId));
    if (filter.vehicleId) conds.push(eq(exceptions.vehicleId, filter.vehicleId));
    if (filter.runDate) conds.push(eq(exceptions.runDate, filter.runDate));
    await tx.update(exceptions).set({ resolvedAt: await this.clock.now(), resolution }).where(and(...conds));
  }
}
