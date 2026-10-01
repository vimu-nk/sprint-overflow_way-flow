import { createFileRoute, Link } from '@tanstack/react-router';
import type { OrderDto } from '@wayflow/shared';
import { PageHeader } from '@/components/shell/app-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { DeliveryTable } from '@/features/store/delivery-table';
import { outletTitle, useStoreHome } from '@/features/store/use-store';
import { dayMonth, hhmm, longDate } from '@/lib/format';

export const Route = createFileRoute('/store/deliveries')({
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({ q: typeof s.q === 'string' ? s.q.slice(0, 40) : undefined }),
  component: Deliveries,
});

/** SM2 My deliveries: status, expected arrival, deferral notice and delayed-update warning (S-05, S-06). */
function Deliveries() {
  const home = useStoreHome();
  const { q } = Route.useSearch();
  const d = home.data;
  const all = (d?.orders ?? []).filter((o) => !q || o.ref.toLowerCase().includes(q.toLowerCase()));
  const runs = [...new Set(all.map((o) => o.runDate))].sort().reverse();
  const focus = d ? (runs.find((r) => r <= d.clock.orderRunDate && all.some((o) => o.runDate === r && o.status !== 'received')) ?? runs[0]) : undefined;
  const today = all.filter((o) => o.runDate === focus);
  const earlier = all.filter((o) => o.runDate !== focus);
  const deferred = today.filter((o) => o.status === 'deferred');
  const issue = today.find((o) => o.status === 'disputed');
  const place = (
    <Link to="/store">
      <Button size="lg">Place order</Button>
    </Link>
  );
  return (
    <>
      <Breadcrumbs items={[{ label: 'Store', to: '/store' }, { label: 'My deliveries' }]} />
      <PageHeader title="My Deliveries" subtitle={d && focus ? `${outletTitle(d.outlet)}. ${longDate(focus)}.` : undefined} action={<span className="hidden lg:block">{place}</span>} />
      {home.isPending ? (
        <Card className="p-5">
          <SkeletonRows rows={3} />
        </Card>
      ) : home.isError ? (
        <ErrorState error={home.error} onRetry={() => void home.refetch()} />
      ) : (
        <div className="flex flex-col gap-6 pb-24 lg:pb-0">
          {d?.updatesDelayed && (
            <Banner tone="offline" title={`Updates delayed. Last update ${hhmm(d.updatesDelayed.since)}`}>
              The delivery vehicle has not sent an update since {hhmm(d.updatesDelayed.since)}. The arrival times below come from the plan and may change.
            </Banner>
          )}
          {deferred.map((o: OrderDto) => (
            <Banner key={o.id} tone="warning" title={`Order ${o.ref} was deferred`}>
              Reason: {o.decision?.storeReason ?? 'Not enough vehicle capacity'}. The dispatcher has recorded the reason and told you. The order goes to the next run{o.carriedTo ? ` (${dayMonth(o.carriedTo.runDate)})` : ''}.
            </Banner>
          ))}
          {issue && (
            <Banner tone="danger" title={`Problem reported at ${hhmm(issue.receipt?.at)}`}>
              You reported {issue.receipt?.damagedUnits ? `${issue.receipt.damagedUnits} damaged units` : 'a problem'} on {issue.ref}
              {issue.receipt?.note ? ` (${issue.receipt.note})` : ''}. The dispatcher has been told.
            </Banner>
          )}
          <Card className="p-5">
            <CardTitle>Today&apos;s Deliveries ({today.length})</CardTitle>
            <div className="mt-4">
              {today.length ? <DeliveryTable orders={today} title="Today's deliveries" /> : <EmptyState title="No deliveries yet" body="Place an order before 16:00 to be on the next morning's run." action={place} />}
            </div>
          </Card>
          {earlier.length > 0 && (
            <Card className="p-5">
              <CardTitle>Other Runs ({earlier.length})</CardTitle>
              <div className="mt-4">
                <DeliveryTable orders={earlier} title="Other runs" />
              </div>
            </Card>
          )}
        </div>
      )}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white px-4 pt-4 safe-bottom lg:hidden">
        <Link to="/store">
          <Button size="xl" block>
            Place order
          </Button>
        </Link>
      </div>
    </>
  );
}
