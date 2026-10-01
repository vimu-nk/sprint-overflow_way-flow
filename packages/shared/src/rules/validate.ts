import { scheduleTrip, sequenceStops } from './schedule.js';
import {
  budgetFor,
  budgetKind,
  MAX_TRIPS_PER_VEHICLE,
  serviceAllowance,
  tripFuelL,
  tripMinutes,
  type BudgetKind,
} from './trip-time.js';
import type {
  AllocationContext,
  AllocationTrip,
  RuleOrder,
  RuleOutlet,
  RuleVehicle,
  Violation,
} from './types.js';

const EPS = 1e-9;
const fmt = (n: number, d = 1) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });

export const tripKey = (vehicleId: string, tripNo: number) => `${vehicleId}-T${tripNo}`;

/**
 * Per order × vehicle compatibility: rules 2 (refrigeration), 3 (access), 4 (home depot)
 * plus vehicle availability. Empty result = compatible.
 */
export function vehicleCompatibility(order: RuleOrder, outlet: RuleOutlet, vehicle: RuleVehicle): Violation[] {
  const out: Violation[] = [];
  const base = { orderRef: order.ref };
  if (vehicle.status !== 'available') {
    out.push({ ...base, rule: 'vehicle_unavailable', message: `${vehicle.vehicleId} is in the workshop today.` });
  }
  if (order.temp === 'chilled' && vehicle.temp !== 'reefer') {
    out.push({
      ...base,
      rule: 'refrigeration',
      message: `${order.ref} is chilled and ${vehicle.vehicleId} is not refrigerated.`,
    });
  }
  if (outlet.parkingConstraint === 'van_only' && vehicle.type !== 'van') {
    out.push({
      ...base,
      rule: 'access',
      message: `${outlet.outletId} is van-only and ${vehicle.vehicleId} is a truck.`,
    });
  }
  if (outlet.depot !== vehicle.depot) {
    out.push({
      ...base,
      rule: 'home_depot',
      message: `${outlet.outletId} is served from ${outlet.depot}; ${vehicle.vehicleId} is based at ${vehicle.depot}.`,
    });
  }
  return out;
}

export interface TripMetrics {
  key: string;
  vehicleId: string;
  tripNo: number;
  brand: RuleOrder['brand'] | null;
  district: string | null;
  weightKg: number;
  volumeM3: number;
  minutes: { outbound: number; interStop: number; handling: number; total: number };
  fuelL: number;
  km: number;
}

export function computeTripMetrics(trip: AllocationTrip, ctx: AllocationContext): TripMetrics {
  const orders = trip.orderRefs.map((r) => ctx.orders.get(r)).filter((o): o is RuleOrder => !!o);
  const first = orders[0];
  const outlet0 = first ? ctx.outlets.get(first.outletId) : undefined;
  const travel = outlet0 ? ctx.travel.get(outlet0.district) : undefined;
  const vehicle = ctx.vehicles.get(trip.vehicleId);
  const handling = orders.map((o) => {
    const outlet = ctx.outlets.get(o.outletId);
    return outlet ? serviceAllowance(ctx.allowance, o.brand, outlet.dockType) : 0;
  });
  const minutes = travel ? tripMinutes(travel, handling) : { outbound: 0, interStop: 0, handling: 0, total: 0 };
  const km = travel && orders.length ? 2 * travel.depotToDistrictKm + travel.interStopKm * (orders.length - 1) : 0;
  return {
    key: tripKey(trip.vehicleId, trip.tripNo),
    vehicleId: trip.vehicleId,
    tripNo: trip.tripNo,
    brand: first?.brand ?? null,
    district: outlet0?.district ?? null,
    weightKg: orders.reduce((a, o) => a + o.weightKg, 0),
    volumeM3: orders.reduce((a, o) => a + o.volumeM3, 0),
    minutes,
    km,
    fuelL: travel && vehicle ? tripFuelL(travel, orders.length, vehicle.kmPerL) : 0,
  };
}

/**
 * Checks a whole allocation against the booklet's seven feasibility rules plus
 * fuel quota, operating day, vehicle availability and mall windows.
 * Used for the planner output (must be empty) and for every dispatcher override.
 */
export function validateAllocation(trips: AllocationTrip[], ctx: AllocationContext): Violation[] {
  const v: Violation[] = [];
  const seen = new Map<string, string>();
  const perVehicle = new Map<string, AllocationTrip[]>();

  const active = trips.filter((t) => t.orderRefs.length > 0);
  if (active.length > 0 && !ctx.isOperatingDay) {
    v.push({ rule: 'operating_day', message: `${ctx.date} is not an operating day.` });
  }

  for (const trip of active) {
    const key = tripKey(trip.vehicleId, trip.tripNo);
    const vehicle = ctx.vehicles.get(trip.vehicleId);
    if (!vehicle) {
      v.push({ rule: 'unknown_reference', tripKey: key, message: `Unknown vehicle ${trip.vehicleId}.` });
      continue;
    }
    if (trip.tripNo < 1 || trip.tripNo > MAX_TRIPS_PER_VEHICLE) {
      v.push({ rule: 'trip_limit', tripKey: key, message: `Trip number must be 1 or 2.` });
    }
    const list = perVehicle.get(trip.vehicleId) ?? [];
    list.push(trip);
    perVehicle.set(trip.vehicleId, list);

    const groups = new Set<string>();
    for (const ref of trip.orderRefs) {
      const order = ctx.orders.get(ref);
      const outlet = order ? ctx.outlets.get(order.outletId) : undefined;
      if (!order || !outlet) {
        v.push({ rule: 'unknown_reference', tripKey: key, orderRef: ref, message: `Unknown order ${ref}.` });
        continue;
      }
      // Rule 5: whole orders, each on exactly one trip.
      const prev = seen.get(ref);
      if (prev) {
        v.push({ rule: 'whole_orders', tripKey: key, orderRef: ref, message: `${ref} is on both ${prev} and ${key}.` });
      }
      seen.set(ref, key);
      groups.add(`${order.brand}|${outlet.district}`);
      for (const c of vehicleCompatibility(order, outlet, vehicle)) v.push({ ...c, tripKey: key });
    }
    // Rule 1: one brand and one district per trip.
    if (groups.size > 1) {
      v.push({
        rule: 'brand_district',
        tripKey: key,
        message: `${key} mixes ${[...groups].map((g) => g.replace('|', ' ')).join(' and ')}. A trip serves one brand in one district.`,
      });
    }
    // Rule 6: capacity, weight and volume both.
    const m = computeTripMetrics(trip, ctx);
    if (m.weightKg > vehicle.weightCapKg + EPS) {
      v.push({
        rule: 'capacity_weight',
        tripKey: key,
        message: `Weight would be ${fmt(m.weightKg, 0)} of ${fmt(vehicle.weightCapKg, 0)} kg.`,
        details: { weightKg: m.weightKg, capKg: vehicle.weightCapKg },
      });
    }
    if (m.volumeM3 > vehicle.volumeCapM3 + EPS) {
      v.push({
        rule: 'capacity_volume',
        tripKey: key,
        message: `Volume would be ${fmt(m.volumeM3)} of ${fmt(vehicle.volumeCapM3)} m³.`,
        details: { volumeM3: m.volumeM3, capM3: vehicle.volumeCapM3 },
      });
    }
  }

  for (const [vehicleId, list] of perVehicle) {
    const vehicle = ctx.vehicles.get(vehicleId)!;
    // Rule 7a: at most two trips per vehicle per day.
    const tripNos = new Set(list.map((t) => t.tripNo));
    if (list.length > MAX_TRIPS_PER_VEHICLE || tripNos.size !== list.length) {
      v.push({
        rule: 'trip_limit',
        tripKey: tripKey(vehicleId, list.length),
        message: `${vehicleId} would run ${list.length} trips. The limit is ${MAX_TRIPS_PER_VEHICLE} per day.`,
      });
    }
    // Rule 7b: separate Fresh (270) and Style + Tech (480) budgets.
    const used: Record<BudgetKind, number> = { fresh: 0, trading: 0 };
    let fuel = 0;
    for (const t of list) {
      const m = computeTripMetrics(t, ctx);
      if (m.brand) used[budgetKind(m.brand)] += m.minutes.total;
      fuel += m.fuelL;
    }
    for (const kind of ['fresh', 'trading'] as const) {
      if (used[kind] > budgetFor(kind)) {
        v.push({
          rule: 'time_budget',
          tripKey: tripKey(vehicleId, list[list.length - 1]!.tripNo),
          message: `${vehicleId} trip time would be ${used[kind]} of ${budgetFor(kind)} min (${kind === 'fresh' ? 'Fresh' : 'Style + Tech'} budget).`,
          details: { minutes: used[kind], budget: budgetFor(kind) },
        });
      }
    }
    // Weekly fuel quota.
    const remaining = vehicle.weeklyFuelQuotaL - (ctx.fuelUsedL.get(vehicleId) ?? 0);
    if (fuel > remaining + EPS) {
      v.push({
        rule: 'fuel_quota',
        tripKey: tripKey(vehicleId, list[0]!.tripNo),
        message: `${vehicleId} needs ${fmt(fuel)} L; ${fmt(Math.max(0, remaining))} L of its weekly quota is left.`,
      });
    }
    // Mall windows are hard: schedule trips in order and check each mall stop.
    let earliest = 0;
    for (const t of [...list].sort((a, b) => a.tripNo - b.tripNo)) {
      const items = t.orderRefs
        .map((r) => ctx.orders.get(r))
        .filter((o): o is RuleOrder => !!o)
        .map((order) => ({ order, outlet: ctx.outlets.get(order.outletId)! }))
        .filter((x) => !!x.outlet);
      if (items.length === 0) continue;
      const travel = ctx.travel.get(items[0]!.outlet.district);
      if (!travel) continue;
      const seq = sequenceStops(items);
      const service = seq.map((x) => serviceAllowance(ctx.allowance, x.order.brand, x.outlet.dockType));
      const sched = scheduleTrip(seq, travel, service, { earliestDepartMin: earliest });
      for (const s of sched.stops) {
        if (s.mallViolation) {
          v.push({
            rule: 'mall_window',
            tripKey: tripKey(vehicleId, t.tripNo),
            orderRef: s.orderRef,
            message: `${s.outletId} only accepts goods until ${String(Math.floor(s.windowCloseMin / 60)).padStart(2, '0')}:${String(s.windowCloseMin % 60).padStart(2, '0')} (mall window).`,
          });
        }
      }
      earliest = sched.returnMin;
    }
  }
  return v;
}

/** Map a hard violation to the deferral reason code the UI and store notice use. */
export function violationToReason(v: Violation, order?: RuleOrder, outlet?: RuleOutlet) {
  switch (v.rule) {
    case 'refrigeration':
      return 'NO_REEFER_CAPACITY' as const;
    case 'access':
      return 'NO_VAN_CAPACITY' as const;
    case 'time_budget':
      return 'TIME_BUDGET' as const;
    case 'trip_limit':
      return 'TRIP_LIMIT' as const;
    case 'fuel_quota':
      return 'FUEL_QUOTA' as const;
    case 'mall_window':
      return 'WINDOW_INFEASIBLE' as const;
    case 'vehicle_unavailable':
      return 'VEHICLE_UNAVAILABLE' as const;
    case 'capacity_weight':
    case 'capacity_volume':
      if (order?.temp === 'chilled') return 'NO_REEFER_CAPACITY' as const;
      if (outlet?.parkingConstraint === 'van_only') return 'NO_VAN_CAPACITY' as const;
      return 'CAPACITY' as const;
    default:
      return 'DISPATCHER_OVERRIDE' as const;
  }
}
