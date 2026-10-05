import { Inject, Injectable } from '@nestjs/common';
import {
  adjustedFactor,
  allowanceKey,
  type AllowanceTable,
  type Brand,
  type Depot,
  type RuleDistrictTravel,
  type RuleOutlet,
  type RuleVehicle,
  type TempRequirement,
  type TravelFactor,
  type VehicleDayStatus,
} from '@wayflow/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { DB, type Db } from '../db/drizzle.module.js';
import {
  calendarDays,
  districtTravel,
  outlets,
  roadConditions,
  serviceAllowances,
  trafficSpeeds,
  unitProfiles,
  vehicleDays,
  vehicles,
} from '../db/schema.js';

export type OutletRow = typeof outlets.$inferSelect;
export type VehicleRow = typeof vehicles.$inferSelect;

/** Reference data is immutable at runtime (loaded from CSVs), so it is cached in memory. */
@Injectable()
export class ReferenceService {
  private cache: {
    outlets: Map<string, OutletRow>;
    vehicles: Map<string, VehicleRow>;
    travel: Map<string, RuleDistrictTravel>;
    allowance: AllowanceTable;
    profiles: Map<string, { kgPerUnit: number; m3PerUnit: number }>;
    speeds: Map<string, number>;
  } | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

  private async load() {
    if (this.cache) return this.cache;
    const [o, v, t, a, p, s] = await Promise.all([
      this.db.select().from(outlets),
      this.db.select().from(vehicles),
      this.db.select().from(districtTravel),
      this.db.select().from(serviceAllowances),
      this.db.select().from(unitProfiles),
      this.db.select().from(trafficSpeeds),
    ]);
    this.cache = {
      outlets: new Map(o.map((x) => [x.outletId, x])),
      vehicles: new Map(v.map((x) => [x.vehicleId, x])),
      travel: new Map(
        t.map((x) => [
          x.district,
          {
            district: x.district,
            depot: x.depot,
            depotToDistrictKm: x.depotToDistrictKm,
            depotToDistrictFreeflowMin: x.depotToDistrictFreeflowMin,
            interStopKm: x.interStopKm,
            interStopFreeflowMin: x.interStopFreeflowMin,
          },
        ]),
      ),
      allowance: Object.fromEntries(a.map((x) => [allowanceKey(x.brand, x.dockType), x.minutes])),
      profiles: new Map(p.map((x) => [`${x.brand}|${x.temp}`, { kgPerUnit: x.kgPerUnit, m3PerUnit: x.m3PerUnit }])),
      speeds: new Map(s.map((x) => [`${x.district}|${x.hour}|${x.monsoon ? 1 : 0}`, x.speedIndex])),
    };
    return this.cache;
  }

  async outlets() {
    return (await this.load()).outlets;
  }
  async outlet(id: string) {
    return (await this.load()).outlets.get(id);
  }
  async vehicles() {
    return (await this.load()).vehicles;
  }
  async travel() {
    return (await this.load()).travel;
  }
  async allowance() {
    return (await this.load()).allowance;
  }

  async unitProfile(brand: Brand, temp: TempRequirement) {
    return (await this.load()).profiles.get(`${brand}|${temp}`) ?? null;
  }

  static ruleOutlet(o: OutletRow): RuleOutlet {
    return {
      outletId: o.outletId,
      brand: o.brand,
      district: o.district,
      depot: o.depot,
      dockType: o.dockType,
      parkingConstraint: o.parkingConstraint,
      windowOpenMin: o.windowOpenMin,
      windowCloseMin: o.windowCloseMin,
      mallOpenMin: o.mallOpenMin,
      mallCloseMin: o.mallCloseMin,
    };
  }

  static ruleVehicle(v: VehicleRow, status: VehicleDayStatus): RuleVehicle {
    return {
      vehicleId: v.vehicleId,
      type: v.type,
      temp: v.temp,
      weightCapKg: v.weightCapKg,
      volumeCapM3: v.volumeCapM3,
      kmPerL: v.kmPerL,
      weeklyFuelQuotaL: v.weeklyFuelQuotaL,
      depot: v.depot,
      status,
    };
  }

  async vehicleStatuses(date: string, ids?: string[]): Promise<Map<string, VehicleDayStatus>> {
    const rows = await this.db
      .select()
      .from(vehicleDays)
      .where(ids ? and(eq(vehicleDays.date, date), inArray(vehicleDays.vehicleId, ids)) : eq(vehicleDays.date, date));
    return new Map(rows.map((r) => [r.vehicleId, r.status]));
  }

  async vehicleDayNotes(date: string): Promise<Map<string, string | null>> {
    const rows = await this.db.select().from(vehicleDays).where(eq(vehicleDays.date, date));
    return new Map(rows.map((r) => [r.vehicleId, r.note]));
  }

  async calendarDay(date: string) {
    const [row] = await this.db.select().from(calendarDays).where(eq(calendarDays.date, date));
    return row ?? null;
  }

  /**
   * Adjusted travel factor for a district on a date (specs/03 §6): traffic speed by hour and
   * monsoon flag, road disruption by date. Outside the calendar range: free flow, no disruption.
   */
  async travelFactor(district: string, date: string): Promise<TravelFactor> {
    const cache = await this.load();
    const cal = await this.calendarDay(date);
    const monsoon = cal?.monsoon ? 1 : 0;
    const [road] = await this.db
      .select()
      .from(roadConditions)
      .where(and(eq(roadConditions.district, district), eq(roadConditions.date, date)));
    const disruption = road?.disruptionIndex ?? 100;
    return (minute: number) => {
      const hour = Math.floor((((minute % 1440) + 1440) % 1440) / 60);
      const speed = cache.speeds.get(`${district}|${hour}|${monsoon}`) ?? 100;
      return adjustedFactor(speed, disruption);
    };
  }

  async depotOf(outletId: string): Promise<Depot | undefined> {
    return (await this.load()).outlets.get(outletId)?.depot;
  }
}
