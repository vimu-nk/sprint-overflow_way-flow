import type { QueryClient } from '@tanstack/react-query';
import type { FieldAction, SyncResult } from '@wayflow/shared';
import { useSyncExternalStore } from 'react';
import { api, ApiError } from '../api';
import { notify } from '../notify';
import { deviceId, fieldDb, type OutboxItem } from './db';

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pending: number;
  attention: number;
  lastSyncAt: string | null;
  offlineSince: string | null;
}

let state: SyncState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  pending: 0,
  attention: 0,
  lastSyncAt: null,
  offlineSince: null,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

let userId: string | null = null;
let qc: QueryClient | null = null;
let backoff = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;

async function refreshCounts() {
  if (!userId) return;
  const db = fieldDb(userId);
  const pending = await db.outbox.where('status').anyOf('pending', 'sending', 'failed').count();
  const attention = await db.outbox.where('status').anyOf('conflict', 'rejected').count();
  set({ pending, attention });
}

/** Start the engine for the signed-in field user. Triggers: start, online, visibility, every 30 s. */
export function startSync(uid: string, client: QueryClient): () => void {
  userId = uid;
  qc = client;
  const online = () => {
    set({ online: true, offlineSince: null });
    void flush(true);
  };
  const offline = () => set({ online: false, offlineSince: state.offlineSince ?? new Date().toISOString() });
  const visible = () => document.visibilityState === 'visible' && void flush();
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  document.addEventListener('visibilitychange', visible);
  const interval = setInterval(() => void flush(), 30_000);
  if (!navigator.onLine) offline();
  void refreshCounts().then(() => flush());
  return () => {
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    document.removeEventListener('visibilitychange', visible);
    clearInterval(interval);
    userId = null;
  };
}

/**
 * Record a field action: saved locally first, then sent if possible (F5: "every outcome is
 * recorded locally before any network call").
 */
export async function enqueue(action: FieldAction, photo?: { blob: Blob; entityType: 'stop' | 'flag' }): Promise<OutboxItem> {
  if (!userId) throw new Error('Sync engine not started');
  const db = fieldDb(userId);
  const clientActionId = crypto.randomUUID();
  let photoId: string | undefined;
  if (photo) {
    photoId = crypto.randomUUID();
    // Flags are keyed by the client action id, so the photo can be linked while offline.
    const entityId = photo.entityType === 'flag' ? clientActionId : 'stopId' in action ? action.stopId : '';
    await db.photos.put({ id: photoId, blob: photo.blob, entityType: photo.entityType, entityId, status: 'waiting' });
  }
  const item: OutboxItem = { clientActionId, createdAtClient: new Date().toISOString(), action, status: 'pending', photoId };
  item.seq = await db.outbox.add(item);
  await refreshCounts();
  void flush();
  return item;
}

function schedule() {
  if (timer) clearTimeout(timer);
  const delay = Math.min(60_000, 2_000 * 2 ** backoff) * (0.75 + Math.random() * 0.5); // backoff with jitter
  timer = setTimeout(() => void flush(), delay);
}

export function flush(announce = false): Promise<void> {
  running ??= doFlush(announce).finally(() => (running = null));
  return running;
}

async function doFlush(announce: boolean) {
  if (!userId) return;
  const db = fieldDb(userId);
  const items = await db.outbox.where('status').anyOf('pending', 'sending', 'failed').sortBy('seq');
  if (!items.length) {
    await uploadPhotos();
    return;
  }
  if (!navigator.onLine) {
    set({ online: false });
    return;
  }
  set({ syncing: true });
  if (announce) notify.info(`Signal is back. Sending ${items.length} item${items.length > 1 ? 's' : ''}…`);
  try {
    let attention = 0;
    for (let i = 0; i < items.length; i += 100) {
      const chunk = items.slice(i, i + 100);
      await db.outbox.bulkUpdate(chunk.map((it) => ({ key: it.seq!, changes: { status: 'sending' as const } })));
      const res = await api<{ results: SyncResult[] }>('/sync/batch', {
        method: 'POST',
        body: { deviceId: deviceId(), actions: chunk.map((it) => ({ clientActionId: it.clientActionId, createdAtClient: it.createdAtClient, action: it.action })) },
      });
      for (const r of res.results) {
        const it = chunk.find((c) => c.clientActionId === r.clientActionId);
        if (!it) continue;
        const status = r.status === 'duplicate' ? 'applied' : r.status;
        if (status === 'conflict' || status === 'rejected') attention++;
        await db.outbox.update(it.seq!, { status, message: r.message, sentAt: new Date().toISOString() });
      }
    }
    backoff = 0;
    set({ online: true, lastSyncAt: new Date().toISOString(), offlineSince: null });
    await uploadPhotos();
    if (announce) {
      if (attention) notify.warning(`${attention} item${attention > 1 ? 's' : ''} need attention`, 'Open Offline and Sync to review.');
      else notify.success('All synced', 'The office has your update.');
    }
    for (const k of ['run', 'loads', 'loader-trip']) void qc?.invalidateQueries({ queryKey: [k] });
  } catch (e) {
    await db.outbox.where('status').equals('sending').modify({ status: 'pending' });
    if (e instanceof ApiError && !e.offline && e.status !== 401 && e.status < 500 && e.status !== 429) {
      await db.outbox.where('status').equals('pending').modify({ status: 'failed', message: e.message });
    } else {
      if (e instanceof ApiError && e.offline) set({ online: false, offlineSince: state.offlineSince ?? new Date().toISOString() });
      backoff = Math.min(backoff + 1, 5);
      schedule();
    }
  } finally {
    set({ syncing: false });
    await refreshCounts();
  }
}

/** Photos upload only after their action is acknowledged (specs/11 §3). */
async function uploadPhotos() {
  if (!userId) return;
  const db = fieldDb(userId);
  const waiting = await db.photos.where('status').equals('waiting').toArray();
  for (const p of waiting) {
    const owner = await db.outbox.filter((o) => o.photoId === p.id).first();
    if (owner && owner.status !== 'applied' && owner.status !== 'conflict') continue;
    const form = new FormData();
    form.append('entityType', p.entityType);
    form.append('entityId', p.entityId);
    form.append('clientAttachmentId', p.id);
    form.append('file', p.blob, 'photo.jpg');
    try {
      await api('/attachments', { method: 'POST', form });
      await db.photos.update(p.id, { status: 'uploaded' });
    } catch (e) {
      if (e instanceof ApiError && e.offline) return;
      await db.photos.update(p.id, { status: 'failed' });
    }
  }
}

/** Retry items that need attention (rejected/failed) — e.g. after the driver fixes the cause. */
export async function retryAll() {
  if (!userId) return;
  await fieldDb(userId).outbox.where('status').anyOf('failed', 'rejected').modify({ status: 'pending' });
  await refreshCounts();
  await flush(true);
}

export async function discard(seq: number) {
  if (!userId) return;
  await fieldDb(userId).outbox.delete(seq);
  await refreshCounts();
}

/** Compress a camera photo on the device: max 1600 px, JPEG ≈0.7 (specs/08 §2.5). */
export async function compressPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('compress failed'))), 'image/jpeg', 0.7));
}
