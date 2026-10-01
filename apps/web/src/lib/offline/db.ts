import Dexie, { type EntityTable } from 'dexie';
import type { FieldAction, SyncResultStatus } from '@wayflow/shared';

export type OutboxStatus = 'pending' | 'sending' | SyncResultStatus | 'failed';

export interface OutboxItem {
  seq?: number;
  clientActionId: string;
  createdAtClient: string;
  action: FieldAction;
  status: OutboxStatus;
  message?: string;
  /** Photo waiting to upload once the action is acknowledged. */
  photoId?: string;
  sentAt?: string;
}

export interface PhotoItem {
  id: string;
  blob: Blob;
  entityType: 'stop' | 'flag' | 'receipt';
  entityId: string;
  status: 'waiting' | 'uploaded' | 'failed';
}

export interface CacheItem {
  key: string;
  value: unknown;
  savedAt: string;
}

export type FieldDb = Dexie & {
  outbox: EntityTable<OutboxItem, 'seq'>;
  photos: EntityTable<PhotoItem, 'id'>;
  cache: EntityTable<CacheItem, 'key'>;
};

const dbs = new Map<string, FieldDb>();

/** One database per user, so a shared device never shows or syncs another user's data (SEC-72). */
export function fieldDb(userId: string): FieldDb {
  let db = dbs.get(userId);
  if (!db) {
    db = new Dexie(`wayflow-${userId}`) as FieldDb;
    db.version(1).stores({ outbox: '++seq, clientActionId, status', photos: 'id, status', cache: 'key' });
    dbs.set(userId, db);
  }
  return db;
}

export async function readCache<T>(userId: string, key: string): Promise<{ value: T; savedAt: string } | null> {
  const row = await fieldDb(userId).cache.get(key);
  return row ? { value: row.value as T, savedAt: row.savedAt } : null;
}

export async function writeCache(userId: string, key: string, value: unknown): Promise<void> {
  await fieldDb(userId).cache.put({ key, value, savedAt: new Date().toISOString() });
}

/** Logout: drop caches but keep unsynced actions, locked to this user (SEC-73). */
export async function clearForLogout(userId: string): Promise<number> {
  const db = fieldDb(userId);
  await db.cache.clear();
  return db.outbox.where('status').anyOf('pending', 'sending', 'failed').count();
}

export function deviceId(): string {
  let id = localStorage.getItem('wayflow.device');
  if (!id) {
    id = `dev-${crypto.randomUUID()}`;
    localStorage.setItem('wayflow.device', id);
  }
  return id;
}
