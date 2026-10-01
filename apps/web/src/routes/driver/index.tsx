import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Clock3, MessageSquareWarning } from 'lucide-react';
import { FieldShell } from '@/components/shell/field-shell';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChilledChip, Chip, MallChip, VanChip } from '@/components/ui/chip';
import { StopPill, TripPill } from '@/components/ui/pill';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { PlanChanged } from '@/features/field/changes';
import { TripLimits } from '@/features/field/limits';
import { useRun } from '@/features/field/use-run';
import { vehicleLabel } from '@/features/dispatcher/trip-card';
import { cn } from '@/lib/cn';
import { hhmm } from '@/lib/format';
import { notify } from '@/lib/notify';
import { enqueue } from '@/lib/offline/sync';

export const Route = createFileRoute('/driver/')({ component: MyRun });

/** DR1 My run (R-01, R-02): stops in order, next stop highlighted, start gated by the loader. */
function MyRun() {
  const { me } = Route.useRouteContext();
  const navigate = useNavigate();
  const { q, run, trips, current: t, ov } = useRun(me);
  const next = t?.stops.find((s) => s.status === 'pending' || s.status === 'arrived');
  const pendingCount = (id: string) => ov.stops.get(id)?.pending;

  const start = async () => {
    if (!t) return;
    await enqueue({ type: 'trip.start', tripId: t.id });
    notify.success(`${t.key} started`, navigator.onLine ? 'The dispatcher and stores can see you are on the way.' : 'Saved on this device. It sends when signal returns.');
  };

  let bottom: React.ReactNode = null;
  if (t && t.status === 'ready') bottom = <Button size="xl" block onClick={() => void start()}>Start trip {t.tripNo}</Button>;
  else if (t && (t.status === 'planned' || t.status === 'loading')) bottom = <Button size="xl" block disabled>Waiting for the loader</Button>;
  else if (t && t.status === 'departed' && next) bottom = <Button size="xl" block onClick={() => void navigate({ to: '/driver/record/$stopId', params: { stopId: next.id } })}>Record delivery</Button>;

  return (
    <FieldShell me={me} syncTo="/driver/sync" bottom={bottom} offlineText={undefined}>
      {q.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-28 rounded-card" />
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !t || !run ? (
        <EmptyState title="No run yet" body="Your trips appear here once the dispatcher publishes the plan." />
      ) : (
        <div className="flex flex-col gap-3">
          <PlanChanged t={t} role="driver" />
          {q.data?.fromCache && <p className="m-0 text-[13px] text-muted">Run saved at {hhmm(q.data.savedAt)}. It refreshes when signal returns.</p>}
          <h1 className="m-0 text-[28px] leading-9 font-bold text-brand-ink">My Run</h1>
          <p className="m-0 text-[16px] text-muted">
            {t.key}, {vehicleLabel(t)}, {t.depot} depot. {t.status === 'planned' || t.status === 'loading' || t.status === 'ready' ? `Departs ${t.depart}. ` : ''}Trip {t.tripNo} of max 2.
          </p>
          {trips
            .filter((x) => x.id !== t.id)
            .map((x) => (
              <Card key={x.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="m-0 font-semibold">{x.key}</p>
                  <p className="m-0 text-[14px] text-muted">
                    Trip {x.tripNo} of max 2. {x.status === 'completed' ? `Back at the ${x.depot} depot ${x.back}.` : `Leaves ${x.depart}, back ${x.back}.`} {x.stopCount} stops.
                  </p>
                </div>
                <TripPill status={x.status} />
              </Card>
            ))}
          {(t.status === 'planned' || t.status === 'loading') && (
            <Banner tone="info" title="Waiting for the loader">You can start once the loader marks {t.vehicleId} loaded and ready.</Banner>
          )}
          <TripLimits t={t} />
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {t.stops.map((s) => {
              const isNext = s.id === next?.id && t.status === 'departed';
              const pending = pendingCount(s.id);
              return (
                <li key={s.id}>
                  <Link to="/driver/stops/$stopId" params={{ stopId: s.id }} className={cn('block rounded-card border p-4 text-ink no-underline', isNext ? 'border-brand/30 bg-brand-tint' : 'border-line bg-white')}>
                    {isNext && <p className="m-0 mb-1 text-[12px] font-bold tracking-wide text-ok uppercase">Next stop</p>}
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[17px] font-semibold">{s.outlet.name}</span>
                      <StopPill status={s.status} />
                    </div>
                    <p className="m-0 text-[15px] text-muted">
                      {s.outlet.outletId}, {s.outlet.windowOpen} to {s.outlet.windowClose}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[15px] text-muted">
                      {s.order.temp === 'chilled' && <ChilledChip />}
                      {s.outlet.parkingConstraint === 'van_only' && <VanChip />}
                      {s.outlet.mallWindow && <MallChip window={s.outlet.mallWindow} />}
                      {pending && (
                        <Chip tone="warning" icon={<Clock3 className="size-3.5" aria-hidden />}>
                          Not synced yet
                        </Chip>
                      )}
                      {s.completedAt ? <span>{hhmm(s.completedAt)}</span> : s.eta ? <span className={s.late ? 'text-warn' : ''}>Estimated {s.eta}{s.late ? ', late risk' : ''}</span> : <span>Planned {s.plannedArrival}</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
          <Link to="/driver/report" className="inline-flex min-h-12 items-center gap-2 font-medium">
            <MessageSquareWarning className="size-5" aria-hidden /> Report a problem
          </Link>
        </div>
      )}
    </FieldShell>
  );
}
