import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { NotificationDto } from '@wayflow/shared';
import { AlertTriangle, Bell, Info, OctagonAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { colomboDate, hhmm } from '@/lib/format';
import { useClock } from '@/lib/queries';
import { notify } from '@/lib/notify';

const icon = (s: NotificationDto['severity']) =>
  s === 'critical' ? <OctagonAlert className="size-4 text-danger" aria-hidden /> : s === 'warning' ? <AlertTriangle className="size-4 text-warn" aria-hidden /> : <Info className="size-4 text-info" aria-hidden />;

/** Notification centre: bell + unread badge, popover on desktop, full-screen sheet on phones. */
export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const unread = useQuery({ queryKey: ['unread'], queryFn: () => get<{ count: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  const list = useQuery({
    queryKey: ['notifications', unreadOnly],
    queryFn: () => get<NotificationDto[]>(`/notifications?limit=50${unreadOnly ? '&unread=true' : ''}`),
    enabled: open,
  });
  const readAll = useMutation({
    mutationFn: () => post('/notifications/read-all'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread'] });
    },
    onError: (e) => notify.fail(e),
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => panel.current && !panel.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const openItem = async (n: NotificationDto) => {
    if (!n.readAt) {
      await post(`/notifications/${n.id}/read`).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['unread'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    }
    setOpen(false);
    if (n.link) void navigate({ to: n.link });
  };
  const count = unread.data?.count ?? 0;
  const clock = useClock();
  const today = clock.data?.date ?? colomboDate(new Date().toISOString());
  const groups = [
    { label: 'Today', items: (list.data ?? []).filter((n) => colomboDate(n.createdAt) === today) },
    { label: 'Earlier', items: (list.data ?? []).filter((n) => colomboDate(n.createdAt) !== today) },
  ];

  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-11 place-items-center rounded-full hover:bg-chip"
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell className="size-5 text-ink" aria-hidden />
        {count > 0 && (
          <span className="absolute top-1.5 right-1.5 grid min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[11px] leading-[18px] font-semibold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white sm:absolute sm:inset-auto sm:top-12 sm:right-0 sm:max-h-[70vh] sm:w-[400px] sm:rounded-card sm:border sm:border-line sm:shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="m-0 text-[17px] font-semibold text-brand-ink">Notifications</h2>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setUnreadOnly((u) => !u)} aria-pressed={unreadOnly}>
                {unreadOnly ? 'Show all' : 'Unread'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => readAll.mutate()} disabled={!count}>
                Mark all read
              </Button>
              <button type="button" className="grid size-11 place-items-center rounded-control hover:bg-chip sm:hidden" onClick={() => setOpen(false)} aria-label="Close">
                <X className="size-5" aria-hidden />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto" aria-live="polite">
            {list.isPending ? (
              <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : list.data?.length ? (
              groups.map((g) =>
                g.items.length ? (
                  <section key={g.label}>
                    <h3 className="m-0 bg-canvas px-4 py-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">{g.label}</h3>
                    <ul className="m-0 list-none p-0">
                      {g.items.map((n) => (
                        <li key={n.id}>
                          <button type="button" onClick={() => void openItem(n)} className={cn('flex w-full gap-3 border-b border-line px-4 py-3 text-left hover:bg-canvas', !n.readAt && 'bg-brand-tint/40')}>
                            <span className="mt-0.5">{icon(n.severity)}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[14px] font-semibold text-ink">{n.title}</span>
                              <span className="block text-[13px] leading-5 text-muted">{n.body}</span>
                              <span className="block text-[12px] text-subtle">{hhmm(n.createdAt)}</span>
                            </span>
                            {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-danger" aria-label="Unread" />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null,
              )
            ) : (
              <p className="m-0 px-4 py-10 text-center text-[14px] text-muted">{unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
