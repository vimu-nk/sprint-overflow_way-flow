import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { DeferralDto, PlanBoardDto, SkippedBeforeDto } from '@wayflow/shared';
import { REASON_CODE_LABEL } from '@wayflow/shared';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/shell/app-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { ChilledChip, SkippedChip, VanChip } from '@/components/ui/chip';
import { Input } from '@/components/ui/form';
import { OrderPill, Pill } from '@/components/ui/pill';
import { SkeletonRows } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { dateSearch, useRunDate } from '@/features/dispatcher/run-date';
import { ApiError, get, post, put } from '@/lib/api';
import { dayMonth, load } from '@/lib/format';
import { notify } from '@/lib/notify';

export const Route = createFileRoute('/dispatcher/deferrals')({ validateSearch: dateSearch, component: Deferrals });

const listRefs = (r: string[]) => (r.length < 2 ? r.join('') : `${r.slice(0, -1).join(', ')} and ${r[r.length - 1]}`);

type Data = { runDate: string; published: boolean; deferred: DeferralDto[]; skippedBefore: SkippedBeforeDto[] };

/** D3 Deferrals & publish: every deferral with its reason and the store notice, plus outlets skipped before. */
function Deferrals() {
  const runDate = useRunDate(Route.useSearch().date);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['deferrals', runDate], queryFn: () => get<Data>(`/dispatcher/deferrals?date=${runDate}`), enabled: !!runDate });
  const board = useQuery({ queryKey: ['plans', runDate], queryFn: () => get<PlanBoardDto>(`/dispatcher/plans?date=${runDate}`), enabled: !!runDate });
  const publishable = (board.data?.depots ?? []).filter((d) => d.planId && ['generated', 'edited', 'replanned'].includes(d.status ?? ''));
  const publish = useMutation({
    mutationFn: async () => {
      for (const d of publishable) await post(`/dispatcher/plans/${d.planId}/publish`, { acknowledgeSecondDeferrals: true });
    },
    meta: { topLoader: true },
    onSuccess: () => {
      notify.success('Plan published', 'The stores have been told, with the reason for each deferral.');
      ['deferrals', 'plans', 'orders', 'live'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => notify.fail(e, 'The plan was not published'),
  });
  const d = q.data;
  const published = d?.published && !publishable.length;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Dispatcher', to: '/dispatcher' }, { label: 'Deferrals' }]} />
      <PageHeader
        title="Deferrals"
        subtitle={
          d && runDate ? (
            published ? (
              `${d.deferred.length} orders were deferred on the ${dayMonth(runDate)} run, each with a reason.`
            ) : (
              `${d.deferred.length} orders cannot be served on the ${dayMonth(runDate)} run. Each one needs a reason before you publish.`
            )
          ) : (
            <Spinner />
          )
        }
        action={
          published ? (
            <Link to="/dispatcher">
              <Button size="lg">View live tracking</Button>
            </Link>
          ) : publishable.length ? (
            <Button size="lg" loading={publish.isPending} onClick={() => publish.mutate()}>
              Publish plan
            </Button>
          ) : undefined
        }
      />
      {published && d && d.deferred.length > 0 && (
        <Banner tone="success" className="mb-6" title="Plan published">
          The stores for {listRefs(d.deferred.map((x) => x.order.ref))} have been told, with the reason for each deferral.
        </Banner>
      )}
      {q.isPending ? (
        <Card className="p-5">
          <SkeletonRows rows={5} />
        </Card>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : d ? (
        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <CardTitle>Deferred Orders ({d.deferred.length})</CardTitle>
            {d.deferred.length === 0 ? (
              <div className="mt-4">
                <EmptyState title="Nothing deferred" body="Every confirmed order is on a trip. Run the allocation first if you have not." />
              </div>
            ) : (
              <div className="mt-2 divide-y divide-line">
                {d.deferred.map((x) => (
                  <DeferralRow key={x.order.id} x={x} published={!!published} />
                ))}
              </div>
            )}
          </Card>
          <Card className="p-5">
            <CardTitle>Skipped Before ({d.skippedBefore.length})</CardTitle>
            {d.skippedBefore.length === 0 ? (
              <p className="mt-3 mb-0 text-muted">No outlet on this run was skipped on the last run.</p>
            ) : (
              <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
                {d.skippedBefore.map((s) => (
                  <li key={s.outlet.outletId} className="flex flex-wrap items-center gap-3">
                    <SkippedChip />
                    <span className="min-w-0 flex-1 text-[15px]">
                      <Link to="/dispatcher/outlets/$outletId" params={{ outletId: s.outlet.outletId }} className="text-ink">
                        {s.outlet.name} ({s.outlet.outletId})
                      </Link>
                      . Skipped on {dayMonth(s.skippedOn)}
                      {s.reason ? ` (${s.reason})` : ''}. {s.today?.tripKey ? `Served first today on ${s.today.tripKey}.` : s.today?.status === 'deferred' ? 'Deferred again today.' : 'Not planned yet.'}
                    </span>
                    {s.today && <OrderPill status={s.today.status} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}

function DeferralRow({ x, published }: { x: DeferralDto; published: boolean }) {
  const o = x.order;
  const qc = useQueryClient();
  const [reason, setReason] = useState(o.decision?.storeReason ?? '');
  useEffect(() => setReason(o.decision?.storeReason ?? ''), [o.decision?.storeReason]);
  const save = useMutation({
    mutationFn: () => put(`/dispatcher/deferrals/${o.id}/reason`, { reason }),
    onSuccess: () => {
      notify.success('Reason saved');
      void qc.invalidateQueries({ queryKey: ['deferrals'] });
    },
    onError: (e) => notify.fail(e instanceof ApiError ? e : null, 'Could not save the reason'),
  });
  const vanOnly = o.outlet.parkingConstraint === 'van_only';
  const dirty = reason !== (o.decision?.storeReason ?? '');
  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 text-[16px]">
            <span className="font-semibold text-link">{o.ref}</span> <span className="text-ink">{o.outlet.name} ({o.outlet.outletId})</span>
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {o.temp === 'chilled' && <ChilledChip />}
            {vanOnly && <VanChip />}
            {o.deferredYesterday && <SkippedChip />}
            <Pill tone={o.decision?.deferralClass === 'unavoidable' ? 'danger' : 'info'}>{o.decision?.deferralClass === 'unavoidable' ? 'Unavoidable' : 'Choice'}</Pill>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-muted">
            {load(o.weightKg, o.volumeM3)}. Window {o.outlet.windowOpen} to {o.outlet.windowClose}. {o.deferredYesterday ? 'Deferred on the last run too.' : `Not deferred on the last run.`}
          </span>
          <OrderPill status={o.status} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`r-${o.id}`} className="text-[14px] font-medium">
            Reason
          </label>
          <div className="flex gap-2">
            <Input id={`r-${o.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={280} disabled={published} />
            {dirty && !published && (
              <Button variant="secondary" onClick={() => save.mutate()} loading={save.isPending} disabled={reason.trim().length < 3}>
                Save
              </Button>
            )}
          </div>
          <p className="m-0 text-[13px] text-muted">{o.decision?.explanation ?? 'Every deferral needs a reason. The store sees it.'}</p>
          {o.decision?.reasonCode && <p className="m-0 text-[12px] text-subtle">Code: {REASON_CODE_LABEL[o.decision.reasonCode]}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between text-[14px] font-medium">
            {published ? 'Store notice' : 'Store notice, sent when you publish'}
            {published && o.decision?.notified && <Pill tone="success">The store has been told</Pill>}
          </span>
          <p className="m-0 rounded-control border border-line bg-canvas px-3 py-2.5 text-[14px]">
            Order {o.ref} is deferred. Reason: {reason || '…'}. The order goes to the next run{o.carriedTo ? ` (${dayMonth(o.carriedTo.runDate)})` : ''}.
          </p>
        </div>
      </div>
    </div>
  );
}
