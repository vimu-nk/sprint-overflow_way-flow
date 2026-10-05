import type { QueryClient } from '@tanstack/react-query';
import type { NotificationDto } from '@wayflow/shared';
import { notify } from './notify';

type StreamEvent =
  | ({ kind: 'notification' } & NotificationDto)
  | { kind: 'invalidate'; keys: string[] };

/**
 * Live updates (specs/09 §3): one EventSource per signed-in tab. Notifications become toasts for
 * warning/critical events; "invalidate" events refetch the affected screens. On reconnect the
 * notification list is refetched so nothing is missed; a 30 s poll covers SSE failures.
 */
export function connectLive(qc: QueryClient, opts: { quiet?: () => boolean } = {}): () => void {
  let es: EventSource | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let failures = 0;

  const open = () => {
    if (closed) return;
    es = new EventSource('/api/v1/notifications/stream', { withCredentials: true });
    es.addEventListener('open', () => {
      failures = 0;
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread'] });
    });
    es.addEventListener('notification', (ev) => {
      const n = JSON.parse((ev as MessageEvent).data) as StreamEvent & { kind: 'notification' };
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread'] });
      if (opts.quiet?.() && n.severity !== 'critical') return;
      const action = n.link ? { label: 'View', onClick: () => window.location.assign(n.link!) } : undefined;
      if (n.severity === 'critical') notify.error(n.title, n.body, action);
      else if (n.severity === 'warning') notify.warning(n.title, n.body, action);
      else notify.info(n.title, n.body, action);
    });
    es.addEventListener('invalidate', (ev) => {
      const e = JSON.parse((ev as MessageEvent).data) as { keys: string[] };
      for (const k of e.keys) void qc.invalidateQueries({ queryKey: [k] });
    });
    es.addEventListener('error', () => {
      failures++;
      if (failures >= 3 && !poll) {
        poll = setInterval(() => {
          void qc.invalidateQueries({ queryKey: ['unread'] });
        }, 30_000);
      }
    });
  };
  open();
  return () => {
    closed = true;
    es?.close();
    if (poll) clearInterval(poll);
  };
}
