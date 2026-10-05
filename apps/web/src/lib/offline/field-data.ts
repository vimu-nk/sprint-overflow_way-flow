import { useQuery } from '@tanstack/react-query';
import type { MeDto, StopStatus, TripDetailDto, TripStatus } from '@wayflow/shared';
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { ApiError, get } from '../api';
import { fieldDb, type OutboxItem, readCache, writeCache } from './db';

export interface Cached<T> {
  data: T;
  fromCache: boolean;
  savedAt: string;
}

/**
 * Network first, IndexedDB second: the run sheet and load lists stay usable offline and across
 * reloads (specs/08 §7 test 1). Data lives in the signed-in user's own database (SEC-72).
 */
export function useFieldData<T>(me: MeDto, key: string[], path: string) {
  return useQuery({
    queryKey: key,
    networkMode: 'always',
    retry: false,
    queryFn: async (): Promise<Cached<T>> => {
      try {
        const data = await get<T>(path);
        await writeCache(me.id, path, data);
        return { data, fromCache: false, savedAt: new Date().toISOString() };
      } catch (e) {
        if (e instanceof ApiError && (e.offline || e.status >= 500)) {
          const c = await readCache<T>(me.id, path);
          if (c) return { data: c.value, fromCache: true, savedAt: c.savedAt };
        }
        throw e;
      }
    },
  });
}

/** Live view of this user's outbox (pending, sent and needs-attention items). */
export function useOutbox(userId: string): OutboxItem[] {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => {
    const sub = liveQuery(() => fieldDb(userId).outbox.orderBy('seq').toArray()).subscribe({ next: setItems, error: () => undefined });
    return () => sub.unsubscribe();
  }, [userId]);
  return items;
}

export const isUnsent = (o: OutboxItem) => o.status === 'pending' || o.status === 'sending' || o.status === 'failed';

export interface StopOverlay {
  status?: StopStatus;
  at?: string;
  pending: boolean;
  loaded?: boolean;
  flagged?: boolean;
  needsAttention?: string;
}

/** Optimistic state from queued actions: a stop shows "Delivered · Not synced yet" until acknowledged. */
export function overlay(outbox: OutboxItem[]) {
  const stops = new Map<string, StopOverlay>();
  const trips = new Map<string, { status?: TripStatus; pending: boolean }>();
  for (const o of outbox) {
    const pending = isUnsent(o);
    const attention = o.status === 'rejected' || o.status === 'conflict' ? o.message : undefined;
    const a = o.action;
    if (a.type === 'stop.outcome' && (pending || attention)) {
      stops.set(a.stopId, { ...stops.get(a.stopId), status: a.outcome, at: o.createdAtClient, pending, needsAttention: attention });
    } else if (a.type === 'load.check' && pending) {
      stops.set(a.stopId, { ...stops.get(a.stopId), loaded: a.loaded, pending });
    } else if (a.type === 'load.flag' && pending) {
      stops.set(a.stopId, { ...stops.get(a.stopId), flagged: true, pending });
    } else if (a.type === 'trip.start' && pending) {
      trips.set(a.tripId, { status: 'departed', pending });
    } else if (a.type === 'load.ready' && pending) {
      trips.set(a.tripId, { status: 'ready', pending });
    }
  }
  return { stops, trips };
}

/** Trip with queued actions applied. */
export function applyOverlay(t: TripDetailDto, o: ReturnType<typeof overlay>): TripDetailDto & { pendingStart: boolean } {
  const to = o.trips.get(t.id);
  return {
    ...t,
    status: to?.status ?? t.status,
    pendingStart: !!to?.pending,
    stops: t.stops.map((s) => {
      const so = o.stops.get(s.id);
      if (!so) return s;
      return { ...s, status: so.status ?? s.status, loaded: so.loaded ?? s.loaded, completedAt: so.at ?? s.completedAt };
    }),
  };
}
