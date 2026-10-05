import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { addDays, type DriverRunDto, type LoaderTripsDto } from '@wayflow/shared';
import { and, asc, eq, gte, isNotNull, ne } from 'drizzle-orm';
import { ClockService } from '../clock/clock.service.js';
import type { SessionUser } from '../common/decorators.js';
import { AppError, notFound } from '../common/errors.js';
import { DB, type Db } from '../db/drizzle.module.js';
import { plans, trips } from '../db/schema.js';
import { ReferenceService } from '../reference/reference.service.js';
import { ViewsService } from '../views/views.service.js';

type TripRow = typeof trips.$inferSelect;

/** Read side for the loader (depot-scoped) and driver (vehicle-scoped) screens. */
@Injectable()
export class FieldService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: ClockService,
    private readonly views: ViewsService,
    private readonly ref: ReferenceService,
  ) {}

  /** Trips visible to field roles: only from plans that have been published at least once. */
  private async publishedTrips(where: ReturnType<typeof and>, fromDate: string) {
    return this.db
      .select({ t: trips })
      .from(trips)
      .innerJoin(plans, eq(plans.id, trips.planId))
      .where(and(where, isNotNull(plans.publishedVersion), ne(trips.status, 'cancelled'), gte(trips.runDate, fromDate)))
      .orderBy(asc(trips.runDate), asc(trips.departMin), asc(trips.vehicleId), asc(trips.tripNo));
  }

  /** The run a field user works on: the earliest published run from yesterday on that is not finished. */
  private pickRun(rows: TripRow[]): string | null {
    const dates = [...new Set(rows.map((t) => t.runDate))].sort();
    for (const d of dates) if (rows.some((t) => t.runDate === d && t.status !== 'completed')) return d;
    return dates[dates.length - 1] ?? null;
  }

  async loaderTrips(user: SessionUser): Promise<LoaderTripsDto> {
    if (!user.depot) throw new AppError('forbidden', 'No depot is linked to this account.', HttpStatus.FORBIDDEN);
    const { date } = await this.clock.parts();
    const rows = (await this.publishedTrips(eq(plans.depot, user.depot), addDays(date, -1))).map((r) => r.t);
    const runDate = this.pickRun(rows);
    return { depot: user.depot, runDate, trips: await this.views.tripDtos(rows.filter((t) => t.runDate === runDate)) };
  }

  /** SEC-26: scope in the query; a trip from another depot is a 404, not a 403. */
  async loaderTrip(user: SessionUser, id: string) {
    if (!user.depot) throw notFound('Trip not found');
    const [row] = await this.db
      .select({ t: trips })
      .from(trips)
      .innerJoin(plans, eq(plans.id, trips.planId))
      .where(and(eq(trips.id, id), eq(plans.depot, user.depot), isNotNull(plans.publishedVersion)));
    if (!row) throw notFound('Trip not found');
    return row.t;
  }

  async driverTrip(user: SessionUser, id: string) {
    if (!user.vehicleId) throw notFound('Trip not found');
    const [row] = await this.db
      .select({ t: trips })
      .from(trips)
      .innerJoin(plans, eq(plans.id, trips.planId))
      .where(and(eq(trips.id, id), eq(trips.vehicleId, user.vehicleId), isNotNull(plans.publishedVersion)));
    if (!row) throw notFound('Trip not found');
    return row.t;
  }

  async loaderTripDetail(user: SessionUser, id: string) {
    return this.views.tripDetail(await this.loaderTrip(user, id));
  }

  async driverRun(user: SessionUser): Promise<DriverRunDto> {
    if (!user.vehicleId) throw new AppError('forbidden', 'No vehicle is linked to this account.', HttpStatus.FORBIDDEN);
    const v = (await this.ref.vehicles()).get(user.vehicleId)!;
    const { date } = await this.clock.parts();
    const rows = (await this.publishedTrips(eq(trips.vehicleId, user.vehicleId), addDays(date, -1))).map((r) => r.t);
    const runDate = this.pickRun(rows);
    const mine = rows.filter((t) => t.runDate === runDate).sort((a, b) => a.tripNo - b.tripNo);
    return {
      vehicle: { vehicleId: v.vehicleId, type: v.type, temp: v.temp, depot: v.depot, weightCapKg: v.weightCapKg, volumeCapM3: v.volumeCapM3, weeklyQuotaL: v.weeklyFuelQuotaL },
      runDate,
      trips: await Promise.all(mine.map((t) => this.views.tripDetail(t))),
    };
  }

  /** Acknowledge the plan-changed banner (records the version the user has seen). */
  async markSeen(trip: TripRow) {
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, trip.planId));
    await this.db.update(trips).set({ seenVersion: plan?.publishedVersion ?? null }).where(eq(trips.id, trip.id));
  }
}
