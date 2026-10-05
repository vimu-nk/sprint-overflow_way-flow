import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { PageHeader } from '@/components/shell/app-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Card } from '@/components/ui/card';
import { OrderPill } from '@/components/ui/pill';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ReceiptForm } from '@/features/store/receipt-form';
import { outletTitle, useStoreHome } from '@/features/store/use-store';
import { cn } from '@/lib/cn';
import { hhmm, longDate } from '@/lib/format';

export const Route = createFileRoute('/store/receipt')({ component: Receipt });

/** SM3 Confirm receipt: orders waiting for the store to confirm what arrived. */
function Receipt() {
  const home = useStoreHome();
  const waiting = (home.data?.orders ?? []).filter((o) => o.status === 'delivered' || o.status === 'partial');
  const [selected, setSelected] = useState<string | null>(null);
  const current = waiting.find((o) => o.id === selected) ?? waiting[0];
  return (
    <>
      <Breadcrumbs items={[{ label: 'Store', to: '/store' }, { label: 'Confirm receipt' }]} />
      <PageHeader title="Confirm Receipt" subtitle={home.data && current ? `${outletTitle(home.data.outlet)}. ${longDate(current.runDate)}.` : home.data ? outletTitle(home.data.outlet) : undefined} />
      {home.isPending ? (
        <Card className="p-5">
          <SkeletonRows rows={3} />
        </Card>
      ) : home.isError ? (
        <ErrorState error={home.error} onRetry={() => void home.refetch()} />
      ) : !current ? (
        <EmptyState title="Nothing to confirm" body="Delivered orders appear here so you can confirm what arrived or report a problem." action={<Link to="/store/deliveries">See my deliveries</Link>} />
      ) : (
        <div className="flex flex-col gap-4">
          {waiting.length > 1 && (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Orders to confirm">
              {waiting.map((o) => (
                <button key={o.id} type="button" role="tab" aria-selected={o.id === current.id} onClick={() => setSelected(o.id)} className={cn('flex min-h-11 items-center gap-2 rounded-control border px-3 text-[14px]', o.id === current.id ? 'border-brand bg-brand-tint' : 'border-line bg-white')}>
                  {o.ref} <span className="text-muted">{hhmm(o.deliveredAt)}</span> <OrderPill status={o.status} />
                </button>
              ))}
            </div>
          )}
          <ReceiptForm key={current.id} order={current} />
        </div>
      )}
    </>
  );
}
