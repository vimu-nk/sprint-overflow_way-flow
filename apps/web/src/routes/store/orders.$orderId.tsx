import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { OrderDto, OrderStatus } from '@wayflow/shared';
import { Check } from 'lucide-react';
import { PageHeader } from '@/components/shell/app-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChilledChip } from '@/components/ui/chip';
import { OrderPill } from '@/components/ui/pill';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { ReceiptForm } from '@/features/store/receipt-form';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dayMonth, hhmm, load } from '@/lib/format';
import { notify } from '@/lib/notify';
import { useClock } from '@/lib/queries';

export const Route = createFileRoute('/store/orders/$orderId')({ component: OrderDetail });

const STEPS: { label: string; done: OrderStatus[] }[] = [
  { label: 'Ordered', done: ['confirmed', 'planned', 'published', 'loaded', 'departed', 'delivered', 'partial', 'failed', 'received', 'disputed'] },
  { label: 'Scheduled', done: ['published', 'loaded', 'departed', 'delivered', 'partial', 'failed', 'received', 'disputed'] },
  { label: 'On the way', done: ['departed', 'delivered', 'partial', 'failed', 'received', 'disputed'] },
  { label: 'Delivered', done: ['delivered', 'partial', 'received', 'disputed'] },
  { label: 'Received', done: ['received'] },
];

/** Order detail: timeline, ETA, deferral notice and receipt (S-04…S-07). */
function OrderDetail() {
  const { orderId } = Route.useParams();
  const qc = useQueryClient();
  const clock = useClock();
  const q = useQuery({ queryKey: ['store-orders', orderId], queryFn: () => get<OrderDto>(`/store/orders/${orderId}`) });
  const cancel = useMutation({
    mutationFn: () => post(`/store/orders/${orderId}/cancel`),
    onSuccess: () => {
      notify.success('Order cancelled');
      void qc.invalidateQueries({ queryKey: ['store-orders'] });
    },
    onError: (e) => notify.fail(e, 'Could not cancel'),
  });
  const o = q.data;
  const canCancel = o && o.status === 'confirmed' && clock.data && (clock.data.orderRunDate === o.runDate || clock.data.orderRunDate < o.runDate);
  return (
    <>
      <Breadcrumbs items={[{ label: 'Store', to: '/store' }, { label: 'My deliveries', to: '/store/deliveries' }, { label: o?.ref ?? 'Order' }]} />
      <PageHeader title={o ? `Order ${o.ref}` : 'Order'} subtitle={o ? `${o.outlet.name} (${o.outlet.outletId}). ${dayMonth(o.runDate)} run.` : undefined} action={o && <OrderPill status={o.status} />} />
      {q.isPending ? (
        <Skeleton className="h-64 rounded-card" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : o ? (
        <div className="flex max-w-3xl flex-col gap-5">
          {o.status === 'deferred' && (
            <Banner tone="warning" title={`Order ${o.ref} was deferred`}>
              Reason: {o.decision?.storeReason}. The order goes to the next run{o.carriedTo ? ` (${dayMonth(o.carriedTo.runDate)}, as ${o.carriedTo.ref})` : ''}.
            </Banner>
          )}
          {o.status === 'failed' && <Banner tone="danger" title="Not delivered">The driver could not deliver this order. The dispatcher will reschedule it to the next run.</Banner>}
          <Card className="p-5">
            <ol className="m-0 grid list-none grid-cols-5 gap-1 p-0" aria-label="Order progress">
              {STEPS.map((s) => {
                const done = s.done.includes(o.status);
                return (
                  <li key={s.label} className="flex flex-col items-center gap-1 text-center text-[12px] sm:text-[13px]">
                    <span className={cn('grid size-7 place-items-center rounded-full', done ? 'bg-brand text-white' : 'bg-chip text-muted')}>{done ? <Check className="size-4" aria-hidden /> : null}</span>
                    <span className={done ? 'font-medium text-ink' : 'text-muted'}>{s.label}</span>
                  </li>
                );
              })}
            </ol>
          </Card>
          <Card className="p-5">
            <dl className="m-0 grid grid-cols-[150px_1fr] gap-y-3 text-[15px]">
              <dt className="text-muted">Contents</dt>
              <dd className="m-0 flex items-center gap-2">
                {o.temp === 'chilled' ? <ChilledChip /> : 'Ambient'} · {o.units} units
              </dd>
              <dt className="text-muted">Estimated load</dt>
              <dd className="m-0">{load(o.weightKg, o.volumeM3)}</dd>
              <dt className="text-muted">Window</dt>
              <dd className="m-0">
                {o.outlet.windowOpen} to {o.outlet.windowClose}
              </dd>
              <dt className="text-muted">Planned arrival</dt>
              <dd className="m-0">
                {o.deliveredAt ? `Delivered ${hhmm(o.deliveredAt)}` : o.eta ? `${o.eta}, estimated from the vehicle's progress` : o.plannedArrival ? `${o.plannedArrival}, plan` : 'Not scheduled'}
                {o.lateRisk && !o.deliveredAt && <span className="ml-2 text-warn">Late risk</span>}
              </dd>
              {o.lastUpdateAt && (
                <>
                  <dt className="text-muted">Last update</dt>
                  <dd className="m-0">{hhmm(o.lastUpdateAt)}</dd>
                </>
              )}
              {o.receipt && (
                <>
                  <dt className="text-muted">Receipt</dt>
                  <dd className="m-0">
                    {o.receipt.unitsReceived} received{o.receipt.damagedUnits ? `, ${o.receipt.damagedUnits} damaged` : ''}
                    {o.receipt.note ? ` (${o.receipt.note})` : ''} at {hhmm(o.receipt.at)}
                  </dd>
                </>
              )}
            </dl>
            {canCancel && (
              <Button className="mt-4" variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                Cancel order
              </Button>
            )}
          </Card>
          {(o.status === 'delivered' || o.status === 'partial') && <ReceiptForm order={o} />}
        </div>
      ) : null}
    </>
  );
}
