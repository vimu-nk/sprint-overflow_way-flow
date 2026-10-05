import type { Brand, DockType } from '../enums.js';
import type { AllowanceTable, RuleDistrictTravel } from './types.js';

/** Daily trip-time budgets per vehicle (specs/03 §4). Fresh is separate from Style + Tech. */
export const FRESH_BUDGET_MIN = 270;
export const TRADING_BUDGET_MIN = 480;
export const MAX_TRIPS_PER_VEHICLE = 2;

export type BudgetKind = 'fresh' | 'trading';

export function budgetKind(brand: Brand): BudgetKind {
  return brand === 'Fresh' ? 'fresh' : 'trading';
}

export function budgetFor(kind: BudgetKind): number {
  return kind === 'fresh' ? FRESH_BUDGET_MIN : TRADING_BUDGET_MIN;
}

export function allowanceKey(brand: Brand, dockType: DockType): string {
  return `${brand}|${dockType}`;
}

export function serviceAllowance(table: AllowanceTable, brand: Brand, dockType: DockType): number {
  const v = table[allowanceKey(brand, dockType)];
  if (v === undefined) throw new Error(`No service allowance for ${brand} / ${dockType}`);
  return v;
}

export interface TripTimeBreakdown {
  outbound: number;
  interStop: number;
  handling: number;
  total: number;
}

/**
 * Task 2B trip-time formula (free flow, no return leg):
 *   outbound + inter_stop × (n − 1) + Σ handling
 */
export function tripMinutes(travel: RuleDistrictTravel, handlingMinutes: number[]): TripTimeBreakdown {
  const n = handlingMinutes.length;
  if (n === 0) return { outbound: 0, interStop: 0, handling: 0, total: 0 };
  const outbound = travel.depotToDistrictFreeflowMin;
  const interStop = travel.interStopFreeflowMin * (n - 1);
  const handling = handlingMinutes.reduce((a, b) => a + b, 0);
  return { outbound, interStop, handling, total: outbound + interStop + handling };
}

/**
 * Fuel for one trip. Unlike trip time, fuel includes the return leg:
 *   km = 2 × depot_to_district + inter_stop × (n − 1)
 */
export function tripKm(travel: RuleDistrictTravel, nOrders: number): number {
  if (nOrders === 0) return 0;
  return 2 * travel.depotToDistrictKm + travel.interStopKm * (nOrders - 1);
}

export function tripFuelL(travel: RuleDistrictTravel, nOrders: number, kmPerL: number): number {
  return tripKm(travel, nOrders) / kmPerL;
}
