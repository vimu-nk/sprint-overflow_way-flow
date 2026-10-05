import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ExceptionDto, OrderDto } from '@wayflow/shared';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/form';
import { OrderPill, Pill } from '@/components/ui/pill';
import { SkeletonRows } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { get, post } from '@/lib/api';
import { dayMonth, hhmm } from '@/lib/format';
import { notify } from '@/lib/notify';

/** D5 exception detail: a right-hand context panel over the live board (full screen on phones). */
export function ExceptionPanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [resolution, setResolution] = useState('');
  useEffect(() => setResolution(''), [id]);
  const q = useQuery({ queryKey: ['exceptions', 'detail', id], queryFn: () => get<{ exception: ExceptionDto; related: OrderDto[] }>(`/dispatcher/exceptions/${id}`), enabled: !!id });
  const resolve = useMutation({
    mutationFn: () => post(`/dispatcher/exceptions/${id}/resolve`, { resolution }),
    onSuccess: () => {
      notify.success('Exception resolved');
      ['exceptions', 'live', 'orders'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => notify.fail(e, 'Could not resolve'),
  });
  const reschedule = useMutation({
    mutationFn: (orderId: string) => post(`/dispatcher/orders/${orderId}/reschedule`, { reason: resolution || 'Not delivered; goes on the next run' }),
    onSuccess: () => {
      notify.success('Order rescheduled', 'It joins the next run with priority.');
      ['exceptions', 'live', 'orders', 'plans'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => notify.fail(e, 'Could not reschedule'),
  });
  if (!id) return null;
  const e = q.data?.exception;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Exception detail">
      <button type="button" className="absolute inset-0 bg-black/30" aria-label="Close" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[560px] flex-col overflow-y-auto bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="m-0 text-[17px] font-semibold text-brand-ink">{e ? `${e.code}. Exception detail` : 'Exception detail'}</h2>
          <button type="button" className="grid size-11 place-items-center rounded-control hover:bg-chip" onClick={onClose} aria-label="Close">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="flex flex-col gap-5 px-6 py-5">
          {q.isPending ? (
            <SkeletonRows rows={6} />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : e ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <h3 className="m-0 text-[22px] font-semibold text-brand-ink">{e.title}</h3>
                <Pill tone={e.resolvedAt ? 'success' : e.severity === 'critical' ? 'danger' : 'warning'}>{e.resolvedAt ? 'Issue resolved' : e.severity === 'critical' ? 'Act now' : 'Act soon'}</Pill>
              </div>
              <dl className="m-0 grid grid-cols-[130px_1fr] gap-x-4 gap-y-3 text-[15px]">
                <dt className="text-muted">Raised</dt>
                <dd className="m-0">
                  {dayMonth(e.raisedAt.slice(0, 10))}, {hhmm(e.raisedAt)}
                  {e.raisedByRole ? `, by the ${e.raisedByRole.replace('_', ' ')}` : ''}
                </dd>
                {e.vehicleId && (
                  <>
                    <dt className="text-muted">Vehicle</dt>
                    <dd className="m-0">{e.tripKey ?? e.vehicleId}</dd>
                  </>
                )}
                {e.outlet && (
                  <>
                    <dt className="text-muted">Outlet</dt>
                    <dd className="m-0">
                      <Link to="/dispatcher/outlets/$outletId" params={{ outletId: e.outlet.outletId }}>
                        {e.outlet.name} ({e.outlet.outletId})
                      </Link>
                    </dd>
                    {e.outlet.mallWindow && (
                      <>
                        <dt className="text-muted">Rule</dt>
                        <dd className="m-0">Mall window {e.outlet.mallWindow}</dd>
                      </>
                    )}
                  </>
                )}
                <dt className="text-muted">What happened</dt>
                <dd className="m-0">{e.body}</dd>
                {e.resolution && (
                  <>
                    <dt className="text-muted">Resolution</dt>
                    <dd className="m-0">{e.resolution}</dd>
                  </>
                )}
              </dl>
              {e.photoUrl && <img src={e.photoUrl} alt="Photo attached to this report" className="max-h-72 w-full rounded-card border border-line object-contain" />}
              {q.data!.related.length > 0 && (
                <div>
                  <h4 className="mt-0 mb-2 text-[15px] font-semibold">Today, {dayMonth(q.data!.related[0]!.runDate)}</h4>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {q.data!.related.map((o) => (
                      <li key={o.id} className="flex items-center justify-between gap-2 rounded-control border border-line p-3 text-[14px]">
                        <span>
                          <strong>{o.ref}</strong> {o.tripKey ? `On ${o.tripKey}.` : 'Not planned.'} Window {o.outlet.windowOpen} to {o.outlet.windowClose}.
                        </span>
                        <OrderPill status={o.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!e.resolvedAt && (
                <div className="flex flex-col gap-3 border-t border-line pt-4">
                  <Field label="Resolution" htmlFor="ex-res" hint="Recorded in the audit log and shown to the store for receipt issues.">
                    <Textarea id="ex-res" value={resolution} onChange={(ev) => setResolution(ev.target.value)} maxLength={400} />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    {(e.type === 'shortfall' || e.type === 'vehicle_workshop' || e.type === 'road_problem' || e.type === 'second_deferral') && (
                      <Link to="/dispatcher/plan">
                        <Button variant="secondary">Re-plan on the plan board</Button>
                      </Link>
                    )}
                    {e.type === 'failed_delivery' && e.orderId && (
                      <Button variant="secondary" loading={reschedule.isPending} onClick={() => reschedule.mutate(e.orderId!)}>
                        Reschedule to next run
                      </Button>
                    )}
                    <Button loading={resolve.isPending} disabled={resolution.trim().length < 3} onClick={() => resolve.mutate()}>
                      Mark resolved
                    </Button>
                  </div>
                </div>
              )}
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
