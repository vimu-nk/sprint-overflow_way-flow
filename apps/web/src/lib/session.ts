import type { MeDto } from '@wayflow/shared';
import { queryOptions } from '@tanstack/react-query';
import { ApiError, get } from './api';

// Non-secret profile hint (id, role, name) so field roles can open the app offline.
// Tokens never leave httpOnly cookies (SEC-13).
const HINT = 'wayflow.profile';

export function cachedProfile(): MeDto | null {
  try {
    const raw = localStorage.getItem(HINT);
    return raw ? (JSON.parse(raw) as MeDto) : null;
  } catch {
    return null;
  }
}

export function clearCachedProfile() {
  localStorage.removeItem(HINT);
}

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async (): Promise<MeDto | null> => {
    try {
      const me = await get<MeDto>('/auth/me');
      localStorage.setItem(HINT, JSON.stringify({ id: me.id, role: me.role, name: me.name, email: me.email, depot: me.depot, vehicleId: me.vehicleId, outlet: me.outlet }));
      return me;
    } catch (e) {
      if (e instanceof ApiError && e.offline) {
        // Offline: drivers and loaders keep working from cache (specs/08, SEC-74).
        const hint = cachedProfile();
        if (hint && (hint.role === 'driver' || hint.role === 'loader')) return hint;
      }
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
      throw e;
    }
  },
  staleTime: 60_000,
  retry: false,
});

/** Accept only same-origin relative paths for ?next= (SEC-31). */
export function safeNext(next: unknown): string | null {
  if (typeof next !== 'string') return null;
  if (!/^\/(dispatcher|store|loader|driver|profile)(\/[A-Za-z0-9\-/]*)?(\?[A-Za-z0-9=&\-]*)?$/.test(next)) return null;
  return next;
}
