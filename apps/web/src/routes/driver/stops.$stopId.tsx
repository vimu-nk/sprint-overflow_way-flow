import { createFileRoute, Link } from '@tanstack/react-router';
import { FieldShell } from '@/components/shell/field-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChilledChip, MallChip } from '@/components/ui/chip';
import { StopPill } from '@/components/ui/pill';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/states';
import { useRun } from '@/features/field/use-run';
import { fmt1, fmtInt } from '@/lib/format';

export const Route = createFileRoute('/driver/stops/$stopId')({ component: StopDetail });

const DOCK: Record<string, string> = { rear_dock: 'Rear dock', street: 'Street (curbside)', mall_bay: 'Mall bay' };

/** DR2 Stop detail: outlet, window, drop-off and every order for this outlet on the trip. */
function StopDetail() {
  const { me } = Route.useRouteContext();
  const { stopId } = Route.useParams();
  const { q, trips } = useRun(me);
  const trip = trips.find((t) => t.stops.some((s) => s.id === stopId));
  const stop = trip?.stops.find((s) => s.id === stopId);
  const atOutlet = trip?.stops.filter((s) => s.outlet.outletId === stop?.outlet.outletId) ?? [];
  const open = atOutlet.find((s) => s.status === 'pending' || s.status === 'arrived');
  return (
    <FieldShell
      me={me}
      syncTo="/driver/sync"
      bottom={
        open && trip?.status === 'departed' ? (
          <Link to="/driver/record/$stopId" params={{ stopId: open.id }}>
            <Button size="xl" block>
              Record delivery
            </Button>
          </Link>
        ) : undefined
      }
    >
      <Breadcrumbs items={[{ label: 'My run', to: '/driver' }, { label: 'Stop detail' }]} />
      {q.isPending ? (
        <Skeleton className="h-72 rounded-card" />
      ) : !stop || !trip ? (
        <EmptyState title="Stop not found" body="It may have moved to another trip. Go back to your run." />
      ) : (
        <div className="flex flex-col gap-4">
          <h1 className="m-0 text-[28px] leading-9 font-bold text-brand-ink">Stop Detail</h1>
          <p className="m-0 text-[17px] font-semibold">
            {stop.outlet.name} ({stop.outlet.outletId})
          </p>
          <Card className="p-4">
            <dl className="m-0 grid grid-cols-[130px_1fr] gap-y-3 text-[16px]">
              <dt className="text-muted">Window</dt>
              <dd className="m-0">
                {stop.outlet.windowOpen} to {stop.outlet.windowClose}
              </dd>
              {stop.outlet.mallWindow && (
                <>
                  <dt className="text-muted">Mall window</dt>
                  <dd className="m-0">{stop.outlet.mallWindow}</dd>
                </>
              )}
              <dt className="text-muted">Planned arrival</dt>
              <dd className="m-0">
                {stop.eta ? `${stop.eta}, estimated` : `${stop.plannedArrival}, plan`}
                {stop.late ? ' (late risk)' : ''}
              </dd>
              <dt className="text-muted">Drop-off</dt>
              <dd className="m-0">{DOCK[stop.outlet.dockType]}{stop.outlet.parkingConstraint === 'van_only' ? ', van access only' : ''}</dd>
              <dt className="text-muted">Trip</dt>
              <dd className="m-0">{trip.key}</dd>
            </dl>
          </Card>
          <h2 className="m-0 text-[17px] font-semibold text-brand-ink">Orders at this stop ({atOutlet.length})</h2>
          {atOutlet.map((s) => (
            <Card key={s.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[17px] font-semibold">{s.order.ref}</span>
                <StopPill status={s.status} />
              </div>
              <div className="flex flex-wrap gap-1.5">{s.order.temp === 'chilled' ? <ChilledChip /> : <span className="text-[15px] text-muted">Ambient</span>}{s.outlet.mallWindow && <MallChip />}</div>
              <dl className="m-0 grid grid-cols-[80px_1fr] gap-y-1 text-[15px]">
                <dt className="text-muted">Units</dt>
                <dd className="m-0">
                  {fmtInt(s.order.units)}
                  {s.flags[0] ? ` (${s.flags[0].unitsAffected} short at loading)` : ''}
                </dd>
                <dt className="text-muted">Load</dt>
                <dd className="m-0">
                  {fmtInt(s.order.weightKg)} kg, {fmt1(s.order.volumeM3)} m³
                </dd>
              </dl>
            </Card>
          ))}
        </div>
      )}
    </FieldShell>
  );
}
