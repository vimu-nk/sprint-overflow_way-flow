import type { DockType } from '../enums.js';
import { budgetKind } from './trip-time.js';
import type { RuleDistrictTravel, RuleOrder, RuleOutlet } from './types.js';

/** Earliest departure from the depot (specs/20 F12): Fresh window opens 03:30, trading day 08:30. */
export const FRESH_OPS_START_MIN = 3 * 60 + 30;
export const TRADING_OPS_START_MIN = 8 * 60 + 30;
export const FRESH_HARD_END_MIN = 8 * 60;

const DOCK_ORDER: Record<DockType, number> = { rear_dock: 0, mall_bay: 1, street: 2 };

export interface SeqItem {
  order: RuleOrder;
  outlet: RuleOutlet;
}

/** Effective window: a mall outlet only accepts goods inside its mall window. */
export function effectiveWindow(outlet: RuleOutlet): { open: number; close: number } {
  if (outlet.parkingConstraint === 'mall_dock' && outlet.mallOpenMin !== null && outlet.mallCloseMin !== null) {
    return {
      open: Math.max(outlet.windowOpenMin, outlet.mallOpenMin),
      close: Math.min(outlet.windowCloseMin, outlet.mallCloseMin),
    };
  }
  return { open: outlet.windowOpenMin, close: outlet.windowCloseMin };
}

/**
 * Stop sequence inside a trip (specs/07 §3.5): earliest window close first, then
 * rear_dock before street, then outlet id, then order ref. Orders for the same outlet
 * stay together.
 */
export function sequenceStops<T extends SeqItem>(items: T[]): T[] {
  const byOutlet = new Map<string, T[]>();
  for (const it of items) {
    const list = byOutlet.get(it.outlet.outletId) ?? [];
    list.push(it);
    byOutlet.set(it.outlet.outletId, list);
  }
  const groups = [...byOutlet.values()].map((g) =>
    g.sort((a, b) => (a.order.temp === b.order.temp ? a.order.ref.localeCompare(b.order.ref) : a.order.temp === 'chilled' ? -1 : 1)),
  );
  groups.sort((ga, gb) => {
    const a = ga[0]!.outlet;
    const b = gb[0]!.outlet;
    const wa = effectiveWindow(a);
    const wb = effectiveWindow(b);
    return (
      wa.close - wb.close ||
      DOCK_ORDER[a.dockType] - DOCK_ORDER[b.dockType] ||
      a.outletId.localeCompare(b.outletId)
    );
  });
  return groups.flat();
}

export interface ScheduledStop {
  orderRef: string;
  outletId: string;
  arrivalMin: number;
  serviceStartMin: number;
  leaveMin: number;
  serviceMin: number;
  windowOpenMin: number;
  windowCloseMin: number;
  late: boolean;
  /** Mall outlets refuse goods outside the mall window: a hard rule. */
  mallViolation: boolean;
}

export interface TripSchedule {
  departMin: number;
  returnMin: number;
  stops: ScheduledStop[];
}

/** Multiplier applied to free-flow travel for a leg starting at `minute` (1 = free flow). */
export type TravelFactor = (minute: number) => number;

/**
 * Planned times for a sequenced trip. Early arrivals wait for the window to open;
 * late arrivals are still delivered but flagged (specs/03 §2.5). Consecutive orders for the
 * same outlet are served in one visit.
 */
export function scheduleTrip(
  items: SeqItem[],
  travel: RuleDistrictTravel,
  serviceMinutes: number[],
  options: { earliestDepartMin?: number; factor?: TravelFactor; fixedDepartMin?: number } = {},
): TripSchedule {
  if (items.length === 0) return { departMin: 0, returnMin: 0, stops: [] };
  const factor = options.factor ?? (() => 1);
  const first = items[0]!;
  const opsStart = budgetKind(first.order.brand) === 'fresh' ? FRESH_OPS_START_MIN : TRADING_OPS_START_MIN;
  const earliest = Math.max(opsStart, options.earliestDepartMin ?? 0);
  const firstOpen = effectiveWindow(first.outlet).open;
  // Leave just in time for the first window, never before the operating start.
  let depart = options.fixedDepartMin ?? Math.max(earliest, firstOpen - travel.depotToDistrictFreeflowMin);
  depart = Math.round(depart);

  const stops: ScheduledStop[] = [];
  let clock = depart;
  let prevOutlet: string | null = null;
  items.forEach((it, i) => {
    const w = effectiveWindow(it.outlet);
    const legFree = prevOutlet === null ? travel.depotToDistrictFreeflowMin : prevOutlet === it.outlet.outletId ? 0 : travel.interStopFreeflowMin;
    const arrival = clock + legFree * factor(clock);
    const sameVisit = prevOutlet === it.outlet.outletId;
    const serviceStart = sameVisit ? arrival : Math.max(arrival, w.open);
    const service = serviceMinutes[i] ?? 0;
    const leave = serviceStart + service;
    const isMall = it.outlet.parkingConstraint === 'mall_dock' && it.outlet.mallCloseMin !== null;
    stops.push({
      orderRef: it.order.ref,
      outletId: it.outlet.outletId,
      arrivalMin: Math.round(arrival),
      serviceStartMin: Math.round(serviceStart),
      leaveMin: Math.round(leave),
      serviceMin: service,
      windowOpenMin: w.open,
      windowCloseMin: w.close,
      late: serviceStart > w.close,
      mallViolation: isMall && serviceStart > w.close,
    });
    clock = leave;
    prevOutlet = it.outlet.outletId;
  });
  const returnMin = Math.round(clock + travel.depotToDistrictFreeflowMin * factor(clock));
  return { departMin: depart, returnMin, stops };
}

/** Adjusted travel factor (specs/03 §6): 100/speed_index × 100/disruption_index, indices clamped to [20, 100]. */
export function adjustedFactor(speedIndex: number, disruptionIndex: number): number {
  const clamp = (v: number) => Math.min(100, Math.max(20, v));
  return (100 / clamp(speedIndex)) * (100 / clamp(disruptionIndex));
}
