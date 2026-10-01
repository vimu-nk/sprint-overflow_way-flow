// Pure allocation helpers around the planner: greedy fallback, repair, mall-window enforcement and
// deferral explanations. No DB or IO here, so every function is unit-tested with plain fixtures.
import {
  type AllocationContext,
  type AllocationTrip,
  type DeferralClass,
  MAX_TRIPS_PER_VEHICLE,
  type ReasonCode,
  type RuleId,
  type RuleOrder,
  type RuleVehicle,
  validateAllocation,
  vehicleCompatibility,
  violationToReason,
  type Violation,
} from '@wayflow/shared';

export interface PlanOrder extends RuleOrder {
  priority: number;
}

export interface Explanation {
  reasonCode: ReasonCode;
  deferralClass: DeferralClass;
  explanation: string;
}

const bucketOf = (ctx: AllocationContext, o: RuleOrder) => `${o.brand}|${ctx.outlets.get(o.outletId)?.district}`;

export function tripsOf(trips: AllocationTrip[], vehicleId: string) {
  return trips.filter((t) => t.vehicleId === vehicleId && t.orderRefs.length > 0);
}

/** Violations for one vehicle's trips only (cheap insertion test). */
export function vehicleViolations(ctx: AllocationContext, trips: AllocationTrip[], vehicleId: string): Violation[] {
  return validateAllocation(tripsOf(trips, vehicleId), ctx);
}

/** All ways to place `ref` on `vehicle`: into each same-bucket trip, or onto a new trip. */
export function insertionOptions(ctx: AllocationContext, trips: AllocationTrip[], ref: string, vehicle: RuleVehicle): AllocationTrip[][] {
  const order = ctx.orders.get(ref)!;
  const mine = tripsOf(trips, vehicle.vehicleId);
  const others = trips.filter((t) => t.vehicleId !== vehicle.vehicleId);
  const out: AllocationTrip[][] = [];
  for (const t of mine) {
    const first = ctx.orders.get(t.orderRefs[0]!)!;
    if (bucketOf(ctx, first) !== bucketOf(ctx, order)) continue;
    out.push([...others, ...mine.map((m) => (m === t ? { ...m, orderRefs: [...m.orderRefs, ref] } : m))]);
  }
  const used = new Set(mine.map((t) => t.tripNo));
  for (let n = 1; n <= MAX_TRIPS_PER_VEHICLE + 1; n++) {
    if (used.has(n)) continue;
    out.push([...others, ...mine, { vehicleId: vehicle.vehicleId, tripNo: n, orderRefs: [ref] }]);
    break;
  }
  return out;
}

function compatibleVehicles(ctx: AllocationContext, o: RuleOrder, includeUnavailable = false): RuleVehicle[] {
  const outlet = ctx.outlets.get(o.outletId)!;
  return [...ctx.vehicles.values()]
    .filter((v) => vehicleCompatibility(o, outlet, v).every((x) => includeUnavailable && x.rule === 'vehicle_unavailable'))
    .sort((a, b) => a.volumeCapM3 - b.volumeCapM3 || a.weightCapKg - b.weightCapKg || a.vehicleId.localeCompare(b.vehicleId));
}

/** Try to place `ref` somewhere feasible. Smallest compatible vehicle first, existing trips before new ones. */
export function tryInsert(ctx: AllocationContext, trips: AllocationTrip[], ref: string): AllocationTrip[] | null {
  const order = ctx.orders.get(ref)!;
  for (const v of compatibleVehicles(ctx, order)) {
    for (const option of insertionOptions(ctx, trips, ref, v)) {
      if (vehicleViolations(ctx, option, v.vehicleId).length === 0) return option;
    }
  }
  return null;
}

/**
 * Deterministic greedy fallback used when the CP-SAT planner is unreachable (degraded mode):
 * priority order, best fit on the smallest compatible vehicle. Always feasible, rarely optimal.
 */
export function greedyAllocate(ctx: AllocationContext, orders: PlanOrder[], pinned: AllocationTrip[] = []): AllocationTrip[] {
  let trips = pinned.map((t) => ({ ...t, orderRefs: [...t.orderRefs] }));
  const placed = new Set(trips.flatMap((t) => t.orderRefs));
  const sorted = [...orders].sort((a, b) => b.priority - a.priority || a.ref.localeCompare(b.ref));
  for (const o of sorted) {
    if (placed.has(o.ref)) continue;
    const next = tryInsert(ctx, trips, o.ref);
    if (next) {
      trips = next;
      placed.add(o.ref);
    }
  }
  return trips;
}

/** Repair pass: add any deferred order that now fits (priority order). Returns the improved trips. */
export function repair(ctx: AllocationContext, trips: AllocationTrip[], deferred: PlanOrder[]): AllocationTrip[] {
  let out = trips;
  for (const o of [...deferred].sort((a, b) => b.priority - a.priority || a.ref.localeCompare(b.ref))) {
    const next = tryInsert(ctx, out, o.ref);
    if (next) out = next;
  }
  return out;
}

/**
 * Mall windows depend on the stop sequence, which the planner does not model. Remove the
 * lowest-priority order from any trip that breaks a mall window until the plan is clean.
 */
export function enforceMallWindows(
  ctx: AllocationContext,
  trips: AllocationTrip[],
  priority: Map<string, number>,
): { trips: AllocationTrip[]; removed: string[] } {
  let out = trips.map((t) => ({ ...t, orderRefs: [...t.orderRefs] }));
  const removed: string[] = [];
  for (let guard = 0; guard < 500; guard++) {
    const v = validateAllocation(out, ctx).filter((x) => x.rule === 'mall_window');
    if (!v.length) break;
    const key = v[0]!.tripKey!;
    const trip = out.find((t) => `${t.vehicleId}-T${t.tripNo}` === key)!;
    const victim = [...trip.orderRefs].sort((a, b) => (priority.get(a) ?? 0) - (priority.get(b) ?? 0) || b.localeCompare(a))[0]!;
    trip.orderRefs = trip.orderRefs.filter((r) => r !== victim);
    removed.push(victim);
    out = out.filter((t) => t.orderRefs.length > 0);
  }
  return { trips: out, removed };
}

const RULE_WEIGHT: Partial<Record<RuleId, number>> = {
  capacity_volume: 1,
  capacity_weight: 1,
  trip_limit: 2,
  time_budget: 3,
  fuel_quota: 4,
  mall_window: 5,
};

/**
 * Explain one deferral (specs/07 §3.8): find the binding constraint by re-testing the order on each
 * compatible vehicle; "unavoidable" when it cannot ride any vehicle even on an empty trip,
 * "choice" when the capacity it needed went to other orders.
 */
export function explainDeferral(
  ctx: AllocationContext,
  trips: AllocationTrip[],
  order: PlanOrder,
  removedForMall = false,
): Explanation {
  const outlet = ctx.outlets.get(order.outletId)!;
  const chilled = order.temp === 'chilled';
  const vanOnly = outlet.parkingConstraint === 'van_only';
  const kind = chilled && vanOnly ? 'refrigerated van' : chilled ? 'refrigerated vehicle' : vanOnly ? 'van' : 'vehicle';

  if (!ctx.isOperatingDay) {
    return { reasonCode: 'VEHICLE_UNAVAILABLE', deferralClass: 'unavoidable', explanation: `${ctx.date} is not an operating day.` };
  }
  if (removedForMall) {
    return {
      reasonCode: 'WINDOW_INFEASIBLE',
      deferralClass: 'unavoidable',
      explanation: `${outlet.outletId} only accepts goods inside its mall window and no trip reaches it in time.`,
    };
  }
  const any = compatibleVehicles(ctx, order, true);
  const available = any.filter((v) => v.status === 'available');
  if (any.length === 0) {
    return {
      reasonCode: chilled ? 'NO_REEFER_CAPACITY' : 'NO_VAN_CAPACITY',
      deferralClass: 'unavoidable',
      explanation: `The ${outlet.depot} depot has no ${kind} for this order.`,
    };
  }
  if (available.length === 0) {
    return {
      reasonCode: 'VEHICLE_UNAVAILABLE',
      deferralClass: 'unavoidable',
      explanation: `Every ${kind} that can take this order is in the workshop (${any.map((v) => v.vehicleId).join(', ')}).`,
    };
  }
  const workshop = any.filter((v) => v.status !== 'available').map((v) => v.vehicleId);
  const workshopNote = workshop.length ? ` ${workshop.join(', ')} ${workshop.length === 1 ? 'is' : 'are'} in the workshop.` : '';

  // Could it ride any compatible vehicle on its own?
  const soloOk = available.some((v) => validateAllocation([{ vehicleId: v.vehicleId, tripNo: 1, orderRefs: [order.ref] }], ctx).length === 0);
  if (!soloOk) {
    const solo = validateAllocation([{ vehicleId: available[0]!.vehicleId, tripNo: 1, orderRefs: [order.ref] }], ctx);
    const v = solo[0];
    const code = v ? violationToReason(v, order, outlet) : 'CAPACITY';
    return {
      reasonCode: code,
      deferralClass: 'unavoidable',
      explanation: `${v?.message ?? 'The order does not fit any compatible vehicle.'} No ${kind} in ${outlet.depot} can carry it even on an empty trip.${workshopNote}`,
    };
  }

  // It fits alone, so the capacity went to other orders. Which rule blocks every insertion?
  const tally = new Map<RuleId, number>();
  for (const v of available) {
    let best: Violation[] | null = null;
    for (const option of insertionOptions(ctx, trips, order.ref, v)) {
      const viol = vehicleViolations(ctx, option, v.vehicleId);
      if (!best || viol.length < best.length) best = viol;
    }
    const rule = (best ?? [])
      .map((x) => x.rule)
      .sort((a, b) => (RULE_WEIGHT[a] ?? 9) - (RULE_WEIGHT[b] ?? 9))[0];
    if (rule) tally.set(rule, (tally.get(rule) ?? 0) + 1);
  }
  const binding = [...tally.entries()].sort((a, b) => b[1] - a[1] || (RULE_WEIGHT[a[0]] ?? 9) - (RULE_WEIGHT[b[0]] ?? 9))[0]?.[0] ?? 'capacity_volume';
  // A chilled or van-only order is limited by the scarce fleet it needs, whatever rule binds there.
  const scarce = ['capacity_volume', 'capacity_weight', 'trip_limit', 'time_budget'].includes(binding);
  const code: ReasonCode = scarce && chilled ? 'NO_REEFER_CAPACITY' : scarce && vanOnly ? 'NO_VAN_CAPACITY' : violationToReason({ rule: binding, message: '' }, order, outlet);
  const served = trips.flatMap((t) => (available.some((v) => v.vehicleId === t.vehicleId) ? t.orderRefs : []));
  const lower = served.filter((r) => ((ctx.orders.get(r) as PlanOrder | undefined)?.priority ?? Infinity) < order.priority).length;
  const what: Record<string, string> = {
    capacity_volume: `every ${kind} that can take it is full by volume`,
    capacity_weight: `every ${kind} that can take it is full by weight`,
    trip_limit: `every ${kind} that can take it already runs 2 trips`,
    time_budget: `adding it would push every ${kind} past its daily trip-time budget`,
    fuel_quota: `the ${kind}s that can take it have too little weekly fuel left`,
  };
  const tradeoff =
    lower > 0
      ? ` The plan serves ${lower} lower-priority order${lower === 1 ? '' : 's'} on these vehicles because they pack better; you can swap them by moving this order.`
      : ' The capacity went to higher-priority orders.';
  return {
    reasonCode: code,
    deferralClass: 'choice',
    explanation: `${available.length} ${kind}${available.length === 1 ? '' : 's'} could carry it, but ${what[binding] ?? 'no capacity is left'}.${tradeoff}${workshopNote}`,
  };
}
