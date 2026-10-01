import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { OutletHistoryDto } from '@wayflow/shared';
import { PageHeader } from '@/components/shell/app-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Card } from '@/components/ui/card';
import { ChilledChip, MallChip, VanChip } from '@/components/ui/chip';
import { OrderPill } from '@/components/ui/pill';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { get } from '@/lib/api';
import { dayMonth, load } from '@/lib/format';

export const Route = createFileRoute('/dispatcher/outlets/$outletId')({ component: OutletHistory });

/** Outlet history (D-05): deliveries, deferrals and issues per outlet. */
function OutletHistory() {
  const { outletId } = Route.useParams();
  const q = useQuery({ queryKey: ['orders', 'outlet', outletId], queryFn: () => get<OutletHistoryDto>(`/dispatcher/outlets/${outletId}`) });
  const d = q.data;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Dispatcher', to: '/dispatcher' }, { label: 'Order queue', to: '/dispatcher/queue' }, { label: outletId }]} />
      <PageHeader title={d ? `${d.outlet.name} (${d.outlet.outletId})` : outletId} subtitle={d ? `${d.outlet.depot} depot. ${d.outlet.dockType.replace('_', ' ')}, window ${d.outlet.windowOpen} to ${d.outlet.windowClose}. ${d.deferrals} deferrals and ${d.issues} delivery issues in the history below.` : undefined} />
      {d && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {d.outlet.parkingConstraint === 'van_only' && <VanChip />}
          {d.outlet.mallWindow && <MallChip window={d.outlet.mallWindow} />}
        </div>
      )}
      {q.isPending ? (
        <Card className="p-5">
          <SkeletonRows />
        </Card>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !d?.orders.length ? (
        <EmptyState title="No orders yet" />
      ) : (
        <Card className="divide-y divide-line">
          {d.orders.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-3 p-4">
              <span className="w-20 shrink-0 text-[14px] text-muted">{dayMonth(o.runDate)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{o.ref}</span> <span className="text-[14px] text-muted">{load(o.weightKg, o.volumeM3)}</span>
                {o.decision?.storeReason && <span className="block text-[13px] text-warn">{o.decision.storeReason}</span>}
                {o.source === 'synthetic_seed' && <span className="block text-[12px] text-subtle">Synthetic demo order</span>}
              </span>
              {o.temp === 'chilled' && <ChilledChip />}
              <span className="text-[14px]">{o.tripKey ?? ''}</span>
              <OrderPill status={o.status} />
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
