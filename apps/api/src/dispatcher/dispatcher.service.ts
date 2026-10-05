import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  DEPOTS,
  type DeferralDto,
  type ExceptionDto,
  type FleetVehicleDto,
  formatDayMonth,
  isoWeekStart,
  type LiveDto,
  type OrderStatus,
  type OutletHistoryDto,
  type PlanBoardDto,
  type PolicyDto,
  POLICY_STEPS,
  type SkippedBeforeDto,
} from '@wayflow/shared';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { ClockService } from '../clock/clock.service.js';
import { notFound } from '../common/errors.js';
import { DB, type Db } from '../db/drizzle.module.js';
import { attachments, decisions, exceptions, orders, outlets, plans, trips, users, vehicleDays } from '../db/schema.js';
import { ReferenceService } from '../reference/reference.service.js';
import { ViewsService } from '../views/views.service.js';
import type { PlanSummary } from '../planning/planning.service.js';

const NO_ID = '00000000-0000-0000-0000-000000000000';
/** Non-empty id list for IN (...) filters. */
const ids = (xs: (string | null)[]) => {
  const v = xs.filter((x): x is string => !!x);
  return v.length ? v : [NO_ID];
};

const ON_RUN: OrderStatus[] = ['planned', 'published', 'loaded', 'departed', 'delivered', 'partial', 'failed', 'received', 'disputed'];

@Injectable()
export class DispatcherService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly views: ViewsService,
    private readonly ref: ReferenceService,
    private readonly clock: ClockService,
  ) {}

  async runDate(date?: string): Promise<string> {
    if (date) return date;
    const { date: today } = await this.clock.parts();
    return this.clock.nextRunDate(today);
  }

  /** D-01: every order for the run date (both depots), including late and cancelled ones. */
  async queue(date: string) {
    const rows = await this.db.select().from(orders).where(and(eq(orders.runDate, date), ne(orders.status, 'draft'))).orderBy(asc(orders.ref));
    const list = await this.views.orderDtos(rows);
    // Orders placed after the cutoff for this run went to the following run; show them as context.
    const late = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.runDate, await this.nextRun(date)), eq(orders.placedAfterCutoff, true), isNull(orders.carriedFromId)));
    return { runDate: date, orders: list, lateOrders: await this.views.orderDtos(late) };
  }

  private async nextRun(date: string) {
    const rows = (await this.db.execute(sql`select date::text as d from calendar_days where date > ${date} and is_operating order by date limit 1`)).rows as { d: string }[];
    return rows[0]?.d ?? addDays(date, 1);
  }

  async board(date: string): Promise<PlanBoardDto> {
    const planRows = await this.db.select().from(plans).where(eq(plans.runDate, date));
    const depots = [];
    for (const depot of DEPOTS) {
      const plan = planRows.find((p) => p.depot === depot);
      const tripRows = plan
        ? await this.db.select().from(trips).where(and(eq(trips.planId, plan.id), ne(trips.status, 'cancelled'))).orderBy(asc(trips.departMin), asc(trips.vehicleId), asc(trips.tripNo))
        : [];
      const [{ n }] = (await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(orders)
        .innerJoin(outlets, eq(outlets.outletId, orders.outletId))
        .where(and(eq(orders.runDate, date), eq(outlets.depot, depot), inArray(orders.status, ['confirmed', 'planned', 'published', 'deferred'])))) as [{ n: number }];
      depots.push({
        depot,
        planId: plan?.id ?? null,
        status: plan?.status ?? null,
        version: plan?.version ?? null,
        publishedVersion: plan?.publishedVersion ?? null,
        publishedAt: plan?.publishedAt?.toISOString() ?? null,
        summary: (plan?.summary as PlanSummary | undefined) ?? null,
        trips: await this.views.tripDtos(tripRows),
        ordersInQueue: n,
      });
    }
    return { runDate: date, depots };
  }

  async trip(id: string) {
    const [t] = await this.db.select().from(trips).where(eq(trips.id, id));
    if (!t) throw notFound('Trip not found');
    return this.views.tripDetail(t);
  }

  /** D3 + D-05: deferred orders with reasons, and outlets skipped on the previous run. */
  async deferrals(date: string) {
    const planRows = await this.db.select().from(plans).where(eq(plans.runDate, date));
    const out: DeferralDto[] = [];
    const statuses = await this.ref.vehicleStatuses(date);
    for (const plan of planRows) {
      const rows = await this.db
        .select({ o: orders })
        .from(decisions)
        .innerJoin(orders, eq(orders.id, decisions.orderId))
        .where(and(eq(decisions.planId, plan.id), eq(decisions.decision, 'deferred')))
        .orderBy(asc(orders.ref));
      const dtos = await this.views.orderDtos(rows.map((r) => r.o));
      const workshop = [...statuses].filter(([, s]) => s === 'in_workshop').map(([id]) => id);
      const vehicles = await this.ref.vehicles();
      for (const d of dtos) {
        out.push({
          order: d,
          planId: plan.id,
          depot: plan.depot,
          vehiclesInWorkshop: workshop.filter((v) => vehicles.get(v)?.depot === plan.depot),
        });
      }
    }
    // Skipped before: today's orders whose outlet was deferred on the last run.
    const today = await this.db.select().from(orders).where(and(eq(orders.runDate, date), eq(orders.deferredYesterday, true)));
    const prevDecisions = today.length
      ? await this.db
          .select({ outletId: orders.outletId, runDate: orders.runDate, reason: decisions.storeReason })
          .from(decisions)
          .innerJoin(orders, eq(orders.id, decisions.orderId))
          .where(and(eq(decisions.decision, 'deferred'), lt(orders.runDate, date), inArray(orders.outletId, today.map((o) => o.outletId))))
          .orderBy(desc(orders.runDate))
      : [];
    const todayDtos = await this.views.orderDtos(today);
    const skipped: SkippedBeforeDto[] = [];
    const seen = new Set<string>();
    for (const o of todayDtos) {
      if (seen.has(o.outlet.outletId)) continue;
      seen.add(o.outlet.outletId);
      const prev = prevDecisions.find((p) => p.outletId === o.outlet.outletId);
      skipped.push({
        outlet: o.outlet,
        skippedOn: prev?.runDate ?? (await this.prevRun(date)),
        reason: prev?.reason ?? (o.source === 'task2b_s1' ? 'Recorded in the Task 2B scenario data' : null),
        today: { ref: o.ref, status: o.status, tripKey: o.tripKey },
      });
    }
    const published = planRows.length > 0 && planRows.every((p) => p.status === 'published' || p.status === 'closed');
    return { runDate: date, published, deferred: out, skippedBefore: skipped };
  }

  private async prevRun(date: string) {
    const rows = (await this.db.execute(sql`select date::text as d from calendar_days where date < ${date} and is_operating order by date desc limit 1`)).rows as { d: string }[];
    return rows[0]?.d ?? addDays(date, -1);
  }

  async exceptionDtos(rows: (typeof exceptions.$inferSelect)[]): Promise<ExceptionDto[]> {
    if (!rows.length) return [];
    const outlets = await this.ref.outlets();
    const tripRows = await this.db.select().from(trips).where(inArray(trips.id, ids(rows.map((r) => r.tripId))));
    const orderRows = await this.db.select({ id: orders.id, ref: orders.ref }).from(orders).where(inArray(orders.id, ids(rows.map((r) => r.orderId))));
    const raisers = await this.db.select({ id: users.id, role: users.role }).from(users).where(inArray(users.id, ids(rows.map((r) => r.raisedBy))));
    const atts = await this.db
      .select()
      .from(attachments)
      .where(inArray(attachments.entityId, ids(rows.flatMap((r) => [r.orderId, r.id]))));
    return rows.map((r) => {
      const t = tripRows.find((x) => x.id === r.tripId);
      const att = atts.find((a) => a.entityId === r.id || (a.entityType === 'receipt' && a.entityId === r.orderId && r.type === 'receipt_issue'));
      return {
        id: r.id,
        code: r.code,
        type: r.type,
        severity: r.severity,
        title: r.title,
        body: r.body,
        vehicleId: r.vehicleId,
        tripId: r.tripId,
        tripKey: t ? `${t.vehicleId}-T${t.tripNo}` : null,
        orderRef: orderRows.find((o) => o.id === r.orderId)?.ref ?? null,
        orderId: r.orderId,
        outlet: r.outletId ? this.views.outlet(outlets.get(r.outletId)!) : null,
        raisedAt: r.raisedAt.toISOString(),
        raisedByRole: raisers.find((u) => u.id === r.raisedBy)?.role ?? null,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolution: r.resolution,
        photoUrl: att ? `/api/v1/attachments/${att.id}/content` : null,
      };
    });
  }

  async exceptions(date: string) {
    const rows = await this.db.select().from(exceptions).where(eq(exceptions.runDate, date)).orderBy(desc(exceptions.raisedAt));
    return this.exceptionDtos(rows);
  }

  async exception(id: string) {
    const [row] = await this.db.select().from(exceptions).where(eq(exceptions.id, id));
    if (!row) throw notFound('Exception not found');
    const [dto] = await this.exceptionDtos([row]);
    // "Today" context: the outlet's order on the current run.
    const today = row.outletId
      ? await this.db.select().from(orders).where(and(eq(orders.outletId, row.outletId), gte(orders.runDate, row.runDate))).orderBy(asc(orders.runDate)).limit(3)
      : [];
    return { exception: dto!, related: await this.views.orderDtos(today) };
  }

  /** D-07 live tracking for both depots. */
  async live(date: string): Promise<LiveDto> {
    const all = await this.db.select().from(orders).where(eq(orders.runDate, date));
    const onRun = all.filter((o) => ON_RUN.includes(o.status));
    const deferred = all.filter((o) => o.status === 'deferred');
    const tripRows = await this.db.select().from(trips).where(and(eq(trips.runDate, date), ne(trips.status, 'cancelled')));
    const tripDtos = await this.views.tripDtos(tripRows);
    const exRows = await this.db.select().from(exceptions).where(eq(exceptions.runDate, date)).orderBy(desc(exceptions.raisedAt)).limit(30);
    // Synthesise "vehicle offline" for silent departed trips so the board shows it without a report.
    for (const t of tripDtos.filter((x) => x.stale)) {
      const exists = exRows.some((e) => e.type === 'vehicle_offline' && e.tripId === t.id && !e.resolvedAt);
      if (!exists) {
        exRows.unshift({
          id: t.id,
          code: `LIVE-${t.key}`,
          type: 'vehicle_offline',
          severity: 'warning',
          runDate: date,
          vehicleId: t.vehicleId,
          tripId: t.id,
          orderId: null,
          outletId: null,
          title: 'Vehicle offline',
          body: `No signal since ${t.lastSignalAt ? new Date(t.lastSignalAt).toISOString().slice(11, 16) : 'departure'} on the ${t.district} run. Next stops projected from the plan.`,
          raisedBy: null,
          raisedAt: t.lastSignalAt ? new Date(t.lastSignalAt) : new Date(),
          resolvedAt: null,
          resolvedBy: null,
          resolution: null,
        });
      }
    }
    const exDtos = await this.exceptionDtos(exRows);
    const open = exDtos.filter((e) => !e.resolvedAt && e.type !== 'plan_changed');
    const status = (s: OrderStatus[]) => onRun.filter((o) => s.includes(o.status)).length;
    const staleTripIds = new Set(tripDtos.filter((t) => t.stale).map((t) => t.id));
    return {
      runDate: date,
      now: (await this.clock.now()).toISOString(),
      kpis: {
        ordersOnRun: onRun.length,
        delivered: status(['delivered', 'received']),
        scheduled: status(['planned', 'published']),
        tripsToday: tripRows.length,
        tripsCompleted: tripRows.filter((t) => t.status === 'completed').length,
        tripsOnRoad: tripRows.filter((t) => t.status === 'departed').length,
        deferred: deferred.length,
        deferredRefs: deferred.map((o) => o.ref).slice(0, 4),
        openExceptions: open.length,
        openExceptionTitles: [...new Set(open.map((e) => e.title))].slice(0, 3),
      },
      progress: {
        allocated: status(['planned', 'published']),
        loading: status(['loaded']),
        inTransit: status(['departed']),
        delivered: status(['delivered', 'received']),
        partial: status(['partial']),
        issues: status(['disputed']),
        failed: status(['failed']),
        stale: staleTripIds.size,
      },
      exceptions: exDtos,
      activeTrips: tripDtos.filter((t) => t.status === 'departed' || t.status === 'ready' || t.status === 'loading'),
    };
  }

  /** D-09: availability and weekly fuel per vehicle. */
  async fleet(date: string): Promise<FleetVehicleDto[]> {
    const vehicles = [...(await this.ref.vehicles()).values()];
    const days = await this.db.select().from(vehicleDays).where(eq(vehicleDays.date, date));
    const weekStart = isoWeekStart(date);
    const tripRows = await this.db
      .select()
      .from(trips)
      .where(and(gte(trips.runDate, weekStart), lt(trips.runDate, addDays(weekStart, 7)), ne(trips.status, 'cancelled')));
    const drivers = await this.db.select({ name: users.name, vehicleId: users.vehicleId }).from(users).where(eq(users.role, 'driver'));
    return vehicles
      .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId))
      .map((v) => {
        const d = days.find((x) => x.vehicleId === v.vehicleId);
        const mine = tripRows.filter((t) => t.vehicleId === v.vehicleId);
        return {
          vehicleId: v.vehicleId,
          type: v.type,
          temp: v.temp,
          depot: v.depot,
          weightCapKg: v.weightCapKg,
          volumeCapM3: v.volumeCapM3,
          weeklyQuotaL: v.weeklyFuelQuotaL,
          fuelUsedL: Math.round(mine.reduce((a, t) => a + (t.metrics.fuelL ?? 0), 0) * 10) / 10,
          status: d?.status ?? 'available',
          note: d?.note ?? null,
          trips: mine.filter((t) => t.runDate === date).map((t) => `${t.vehicleId}-T${t.tripNo}`),
          driverName: drivers.find((x) => x.vehicleId === v.vehicleId)?.name ?? null,
        };
      });
  }

  async outletHistory(outletId: string): Promise<OutletHistoryDto> {
    const outlet = await this.ref.outlet(outletId);
    if (!outlet) throw notFound('Outlet not found');
    const rows = await this.db.select().from(orders).where(eq(orders.outletId, outletId)).orderBy(desc(orders.runDate), asc(orders.ref)).limit(60);
    const dtos = await this.views.orderDtos(rows);
    return {
      outlet: this.views.outlet(outlet),
      orders: dtos,
      deferrals: dtos.filter((o) => o.status === 'deferred').length,
      issues: dtos.filter((o) => o.status === 'disputed' || o.status === 'failed' || o.status === 'partial').length,
    };
  }

  /** D-11: one-page prioritisation write-up generated from the actual plan. */
  async policy(planId: string): Promise<PolicyDto> {
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, planId));
    if (!plan) throw notFound('Plan not found');
    const outletsMap = await this.ref.outlets();
    const ordersRows = await this.db
      .select({ o: orders })
      .from(orders)
      .innerJoin(outlets, eq(outlets.outletId, orders.outletId))
      .where(and(eq(orders.runDate, plan.runDate), eq(outlets.depot, plan.depot), ne(orders.status, 'cancelled'), ne(orders.status, 'draft')));
    const decs = await this.db
      .select({ d: decisions, o: orders })
      .from(decisions)
      .innerJoin(orders, eq(orders.id, decisions.orderId))
      .where(and(eq(decisions.planId, plan.id), eq(decisions.decision, 'deferred')));
    const statuses = await this.ref.vehicleStatuses(plan.runDate);
    const depotVehicles = [...(await this.ref.vehicles()).values()].filter((v) => v.depot === plan.depot);
    const cal = await this.ref.calendarDay(plan.runDate);
    const byBrand: Record<string, number> = {};
    for (const { o } of ordersRows) byBrand[o.brand] = (byBrand[o.brand] ?? 0) + 1;
    return {
      runDate: plan.runDate,
      depot: plan.depot,
      version: plan.publishedVersion,
      steps: POLICY_STEPS,
      summary: (plan.summary as PlanSummary | null) ?? null,
      fleet: {
        available: depotVehicles.filter((v) => statuses.get(v.vehicleId) !== 'in_workshop').length,
        inWorkshop: depotVehicles.filter((v) => statuses.get(v.vehicleId) === 'in_workshop').map((v) => v.vehicleId),
      },
      demand: {
        orders: ordersRows.length,
        chilled: ordersRows.filter((r) => r.o.temp === 'chilled').length,
        weightKg: Math.round(ordersRows.reduce((a, r) => a + r.o.weightKg, 0)),
        volumeM3: Math.round(ordersRows.reduce((a, r) => a + r.o.volumeM3, 0) * 10) / 10,
        byBrand,
      },
      deferred: decs.map(({ d, o }) => {
        const outlet = outletsMap.get(o.outletId)!;
        const consequence =
          o.brand === 'Fresh'
            ? `${outlet.name} misses ${o.temp} morning stock on ${formatDayMonth(plan.runDate)}; the order leads the next run.`
            : o.brand === 'Style'
              ? `${outlet.name} waits one more run for ${o.units} units of garments and cartons.`
              : `${outlet.name} waits one more run for its appliances.`;
        return { ref: o.ref, outletName: outlet.name, reasonCode: d.reasonCode!, deferralClass: d.deferralClass ?? 'choice', explanation: d.explanation ?? '', consequence };
      }),
      calendar: cal ? { isPayday: cal.isPayday, festival: cal.festival, festivalRamp: cal.festivalRamp, monsoon: cal.monsoon, isOperating: cal.isOperating } : null,
    };
  }

  /** Header search: orders, trips and outlets matching a short query. */
  async search(q: string, date: string) {
    const term = `%${q.replace(/[%_\\]/g, '')}%`;
    const orderRows = await this.db.select().from(orders).where(and(eq(orders.runDate, date), or(ilike(orders.ref, term), ilike(orders.outletId, term)))).limit(8);
    const tripRows = await this.db.select().from(trips).where(and(eq(trips.runDate, date), ne(trips.status, 'cancelled'), ilike(trips.vehicleId, term))).limit(6);
    const outletRows = await this.db.select().from(outlets).where(or(ilike(outlets.outletId, term), ilike(outlets.name, term))).limit(6);
    return {
      orders: orderRows.map((o) => ({ id: o.id, ref: o.ref, outletId: o.outletId, status: o.status })),
      trips: tripRows.map((t) => ({ id: t.id, key: `${t.vehicleId}-T${t.tripNo}`, status: t.status })),
      outlets: outletRows.map((o) => ({ outletId: o.outletId, name: o.name })),
    };
  }
}
