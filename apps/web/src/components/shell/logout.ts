import type { QueryClient } from '@tanstack/react-query';
import { post } from '@/lib/api';
import { clearForLogout } from '@/lib/offline/db';
import { clearCachedProfile } from '@/lib/session';

/** Logout clears caches and the profile hint but keeps unsynced field actions (SEC-15, SEC-73). */
export async function logout(qc: QueryClient, userId: string | undefined): Promise<void> {
  await post('/auth/logout').catch(() => undefined);
  if (userId) await clearForLogout(userId).catch(() => 0);
  clearCachedProfile();
  qc.clear();
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('wayflow-runtime')).map((k) => caches.delete(k)));
  }
}

export async function pendingCount(userId: string): Promise<number> {
  const { fieldDb } = await import('@/lib/offline/db');
  return fieldDb(userId).outbox.where('status').anyOf('pending', 'sending', 'failed').count();
}
