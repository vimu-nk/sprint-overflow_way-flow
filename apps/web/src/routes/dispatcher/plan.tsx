import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { DepotPlanDto, OrderDto, PlanBoardDto } from '@wayflow/shared';
import { REASON_CODE_LABEL } from '@wayflow/shared';
import { FileText, Play, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/shell/app-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChilledChip, SkippedChip, VanChip } from '@/components/ui/chip';
import { Dialog } from '@/components/ui/dialog';
import { OrderPill } from '@/components/ui/pill';
import { SkeletonCards } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { MoveDialog } from '@/features/dispatcher/move-dialog';
import { dateSearch, useRunDate } from '@/features/dispatcher/run-date';
import { TripCard } from '@/features/dispatcher/trip-card';
import { TripSheet } from '@/features/dispatcher/trip-sheet';
import { ApiError, get, post } from '@/lib/api';
import { dayMonth, load, longDate } from '@/lib/format';
import { notify } from '@/lib/notify';

export const Route = createFileRoute('/dispatcher/plan')({ validateSearch: dateSearch, component: PlanBoard });

function PlanBoard() {
  const runDate = useRunDate(Route.useSearch().date);
  const qc = useQueryClient();
  const [tripId, setTripId] = useState<string | null>(null);
  const [moving, setMoving] = useState<OrderDto | null>(null);
  const [ackFor, setAckFor] = useState<{ planId: string; message: string } | null>(null);
  const board = useQuery({ queryKey: ['plans', runDate], queryFn: () => get<PlanBoardDto>(`/dispatcher/plans?date=${runDate}`), enabled: !!runDate });
  const deferred = useQuery({ queryKey: ['orders', runDate], queryFn: () => get<{ orders: OrderDto[] }>(`/dispatcher/orders?date=${runDate}`), enabled: !!runDate });
  const refresh = () => ['plans', 'orders', 'deferrals', 'live', 'fleet'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));

  const run = useMutation({
    mutationFn: (depot: string) => post<{ summary: { served: number; deferred: number }; republished: number | null }>('/dispatcher/plans/run', { date: runDate, depot }),
    meta: { topLoader: true },
    onSuccess: (r, depot) => {
      notify.success(`${depot} allocation ready`, `${r.summary.served} orders on trips, ${r.summary.deferred} deferred with reasons.${r.republished ? ` Republished as version ${r.republished}.` : ''}`);
      refresh();
    },
    onError: (e) => notify.fail(e, 'The allocation did not run'),
  });
  const publish = useMutation({
    mutationFn: (v: { planId: string; ack: boolean }) => post<{ version: number; changes: number }>(`/dispatcher/plans/${v.planId}/publish`, { acknowledgeSecondDeferrals: v.ack }),
    meta: { topLoader: true },
    onSuccess: (r) => {
      setAckFor(null);
      notify.success(r.version === 1 ? 'Plan published' : `Plan republished (version ${r.version})`, 'Loader, drivers and stores have been told.', { label: 'View live tracking', onClick: () => window.location.assign('/dispatcher') });
      refresh();
    },
    onError: (e, v) => {
      if (e instanceof ApiError && e.code === 'second_deferral_ack_required') setAckFor({ planId: v.planId, message: e.message });
      else notify.fail(e, 'The plan was not published');
    },
  });

  const depots = board.data?.depots ?? [];
  const totalTrips = depots.reduce((a, d) => a + d.trips.length, 0);
  const totalDeferred = depots.reduce((a, d) => a + (d.summary?.deferred ?? 0), 0);
  const publishable = depots.filter((d) => d.planId && ['generated', 'edited', 'replanned'].includes(d.status ?? ''));
  const anyPublished = depots.some((d) => d.publishedVersion);
  const deferredOrders = (deferred.data?.orders ?? []).filter((o) => o.status === 'deferred');

  return (
    <>
      <Breadcrumbs items={[{ label: 'Dispatcher', to: '/dispatcher' }, { label: 'Plan board' }]} />
      <PageHeader
        title="Plan Board"
        subtitle={
          runDate ? (
            anyPublished && !publishable.length ? (
              <>Plan published. A change is republished, and the loader and drivers are alerted.</>
            ) : (
              <>
                {longDate(runDate)} run. {totalTrips} trips, {totalDeferred} orders deferred. Every load must fit weight and volume.
              </>
            )
          ) : (
            <Spinner />
          )
        }
        action={
          publishable.length ? (
            <Button size="lg" loading={publish.isPending} onClick={() => publishable.forEach((d) => publish.mutate({ planId: d.planId!, ack: false }))}>
              {anyPublished ? 'Republish plan' : 'Publish plan'}
            </Button>
          ) : undefined
        }
      />
      {board.isPending ? (
        <SkeletonCards count={6} className="sm:grid-cols-2 xl:grid-cols-3" />
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : (
        <div className="flex flex-col gap-8">
          {depots.map((d) => (
            <DepotSection key={d.depot} d={d} runDate={runDate!} running={run.isPending && run.variables === d.depot} onRun={() => run.mutate(d.depot)} onOpen={setTripId} />
          ))}
          {deferredOrders.length > 0 && (
            <section>
              <h2 className="mt-0 mb-3 text-[18px] font-semibold text-brand-ink">Deferred Orders ({deferredOrders.length})</h2>
              <Card className="divide-y divide-line">
                {deferredOrders.map((o) => (
                  <div key={o.id} className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 font-medium">
                        <span className="text-link">{o.ref}</span> {o.outlet.name} ({o.outlet.outletId})
                      </p>
                      <p className="m-0 text-[13px] text-muted">
                        {load(o.weightKg, o.volumeM3)}. {o.decision?.reasonCode ? REASON_CODE_LABEL[o.decision.reasonCode] : ''} · {o.decision?.deferralClass === 'unavoidable' ? 'Unavoidable' : 'Choice'}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {o.temp === 'chilled' && <ChilledChip />}
                        {o.outlet.parkingConstraint === 'van_only' && <VanChip />}
                        {o.deferredYesterday && <SkippedChip />}
                      </div>
                    </div>
                    <OrderPill status={o.status} />
                    <Button size="sm" variant="secondary" onClick={() => setMoving(o)}>
                      Place on a trip
                    </Button>
                  </div>
                ))}
              </Card>
            </section>
          )}
        </div>
      )}
      <TripSheet tripId={tripId} onClose={() => setTripId(null)} onMove={(o) => (setTripId(null), setMoving(o))} editable />
      {runDate && <MoveDialog order={moving} runDate={runDate} onClose={() => setMoving(null)} />}
      <Dialog open={!!ackFor} onClose={() => setAckFor(null)} title="Second deferral">
        <p className="mt-0">{ackFor?.message}</p>
        <p className="text-[14px] text-muted">These stores were skipped on the last run as well. Publishing confirms you have reviewed them; the stores are told the reason.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setAckFor(null)}>
            Review deferrals
          </Button>
          <Button loading={publish.isPending} onClick={() => ackFor && publish.mutate({ planId: ackFor.planId, ack: true })}>
            Acknowledge and publish
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function DepotSection({ d, runDate, running, onRun, onOpen }: { d: DepotPlanDto; runDate: string; running: boolean; onRun: () => void; onOpen: (id: string) => void }) {
  const s = d.summary;
  return (
    <section aria-labelledby={`depot-${d.depot}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id={`depot-${d.depot}`} className="m-0 text-[18px] font-semibold text-brand-ink">
          {d.depot} Depot ({d.trips.length} trips)
        </h2>
        <div className="flex flex-wrap gap-2">
          {d.planId && (
            <Link to="/dispatcher/policy/$planId" params={{ planId: d.planId }}>
              <Button variant="ghost" size="sm">
                <FileText className="size-4" aria-hidden /> Policy write-up
              </Button>
            </Link>
          )}
          <Button variant="secondary" size="sm" onClick={onRun} loading={running}>
            {d.planId ? <RefreshCw className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
            {d.planId ? (d.publishedVersion ? 'Re-plan' : 'Run again') : 'Run allocation'}
          </Button>
        </div>
      </div>
      {s && s.deferred > 0 && (
        <Banner tone="warning" className="mb-4" title={`${s.served} served, ${s.deferred} deferred (${s.unavoidable} unavoidable, ${s.choice} by choice)`}>
          Limiting resource: <strong>{s.limiting?.label ?? 'none'}</strong>. {s.vehiclesUsed} of {s.vehiclesAvailable} available vehicles used. Engine {s.engine === 'greedy-fallback' ? 'fallback (planner offline)' : 'OR-Tools'} in {(s.solveMs / 1000).toFixed(1)} s.{' '}
          <Link to="/dispatcher/deferrals" search={{ date: runDate }}>
            Review deferrals
          </Link>
        </Banner>
      )}
      {s?.engine === 'greedy-fallback' && <Banner tone="info" className="mb-4" title="Planner offline: fallback engine used">The built-in greedy engine made this plan. Every rule is still checked. Run again when the planner is back for a better fit.</Banner>}
      {d.trips.length === 0 ? (
        <EmptyState title={d.planId ? 'No trips on this plan' : `No plan yet for ${dayMonth(runDate)}`} body={`${d.ordersInQueue} confirmed orders are waiting in the ${d.depot} queue.`} action={!d.planId ? <Button onClick={onRun} loading={running}>Run allocation</Button> : undefined} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {d.trips.map((t) => (
            <TripCard key={t.id} t={t} onOpen={() => onOpen(t.id)} />
          ))}
        </div>
      )}
    </section>
  );
}
