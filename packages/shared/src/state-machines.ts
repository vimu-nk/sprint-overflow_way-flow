import type { OrderStatus, PlanStatus, Role, StopStatus, TripStatus } from './enums.js';

/**
 * Transition tables (specs/20 F6, F7). One table per aggregate; the API calls
 * `assertTransition` before every status change, so illegal moves fail server-side.
 */
export interface Transition<S extends string> {
  from: S;
  to: S;
  roles: readonly (Role | 'system')[];
}

export const ORDER_TRANSITIONS: readonly Transition<OrderStatus>[] = [
  { from: 'draft', to: 'confirmed', roles: ['store_manager'] },
  { from: 'draft', to: 'cancelled', roles: ['store_manager'] },
  { from: 'confirmed', to: 'cancelled', roles: ['store_manager'] },
  { from: 'confirmed', to: 'planned', roles: ['dispatcher', 'system'] },
  { from: 'confirmed', to: 'deferred', roles: ['dispatcher', 'system'] },
  { from: 'planned', to: 'deferred', roles: ['dispatcher', 'system'] },
  { from: 'planned', to: 'confirmed', roles: ['dispatcher', 'system'] },
  { from: 'deferred', to: 'planned', roles: ['dispatcher', 'system'] },
  { from: 'planned', to: 'published', roles: ['dispatcher'] },
  { from: 'published', to: 'deferred', roles: ['dispatcher'] },
  { from: 'published', to: 'planned', roles: ['dispatcher'] },
  { from: 'published', to: 'loaded', roles: ['loader'] },
  { from: 'loaded', to: 'departed', roles: ['driver'] },
  { from: 'departed', to: 'delivered', roles: ['driver'] },
  { from: 'departed', to: 'partial', roles: ['driver'] },
  { from: 'departed', to: 'failed', roles: ['driver'] },
  { from: 'delivered', to: 'received', roles: ['store_manager'] },
  { from: 'delivered', to: 'disputed', roles: ['store_manager'] },
  { from: 'partial', to: 'received', roles: ['store_manager'] },
  { from: 'partial', to: 'disputed', roles: ['store_manager'] },
  { from: 'failed', to: 'deferred', roles: ['dispatcher'] },
  { from: 'deferred', to: 'confirmed', roles: ['system'] },
  { from: 'disputed', to: 'received', roles: ['dispatcher'] },
];

export const PLAN_TRANSITIONS: readonly Transition<PlanStatus>[] = [
  { from: 'generated', to: 'edited', roles: ['dispatcher'] },
  { from: 'edited', to: 'edited', roles: ['dispatcher'] },
  { from: 'generated', to: 'generated', roles: ['dispatcher'] },
  { from: 'edited', to: 'generated', roles: ['dispatcher'] },
  { from: 'generated', to: 'published', roles: ['dispatcher'] },
  { from: 'edited', to: 'published', roles: ['dispatcher'] },
  { from: 'published', to: 'replanned', roles: ['dispatcher', 'system'] },
  { from: 'replanned', to: 'replanned', roles: ['dispatcher', 'system'] },
  { from: 'replanned', to: 'published', roles: ['dispatcher'] },
  { from: 'published', to: 'closed', roles: ['system'] },
];

export const TRIP_TRANSITIONS: readonly Transition<TripStatus>[] = [
  { from: 'planned', to: 'loading', roles: ['loader'] },
  { from: 'loading', to: 'loading', roles: ['loader', 'dispatcher', 'system'] },
  { from: 'planned', to: 'ready', roles: ['loader'] },
  { from: 'loading', to: 'ready', roles: ['loader'] },
  { from: 'ready', to: 'loading', roles: ['dispatcher', 'system'] },
  { from: 'ready', to: 'departed', roles: ['driver'] },
  { from: 'departed', to: 'completed', roles: ['driver', 'system'] },
  { from: 'planned', to: 'cancelled', roles: ['dispatcher', 'system'] },
  { from: 'loading', to: 'cancelled', roles: ['dispatcher', 'system'] },
  { from: 'ready', to: 'cancelled', roles: ['dispatcher', 'system'] },
];

export const STOP_TRANSITIONS: readonly Transition<StopStatus>[] = [
  { from: 'pending', to: 'arrived', roles: ['driver'] },
  { from: 'pending', to: 'delivered', roles: ['driver'] },
  { from: 'pending', to: 'partial', roles: ['driver'] },
  { from: 'pending', to: 'failed', roles: ['driver'] },
  { from: 'arrived', to: 'delivered', roles: ['driver'] },
  { from: 'arrived', to: 'partial', roles: ['driver'] },
  { from: 'arrived', to: 'failed', roles: ['driver'] },
  { from: 'pending', to: 'skipped', roles: ['dispatcher', 'system'] },
];

export function canTransition<S extends string>(
  table: readonly Transition<S>[],
  from: S,
  to: S,
  role: Role | 'system',
): boolean {
  return table.some((t) => t.from === from && t.to === to && t.roles.includes(role));
}

export class TransitionError extends Error {
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
    readonly role: string,
  ) {
    super(`${entity} cannot move from ${from} to ${to} (${role}).`);
  }
}

export function assertTransition<S extends string>(
  entity: string,
  table: readonly Transition<S>[],
  from: S,
  to: S,
  role: Role | 'system',
): void {
  if (!canTransition(table, from, to, role)) throw new TransitionError(entity, from, to, role);
}
