import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { TripDetailDto } from '@wayflow/shared';
import { FAILURE_REASON_LABEL } from '@wayflow/shared';
import { PageHeader } from '@/components/shell/app-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Card } from '@/components/ui/card';
import { ChilledChip, MallChip, VanChip } from '@/components/ui/chip';
import { StopPill } from '@/components/ui/pill';
import { SkeletonCards } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { TripCard } from '@/features/dispatcher/trip-card';
import { get } from '@/lib/api';
import { hhmm, load } from '@/lib/format';

export const Route = createFileRoute('/dispatcher/trips/$tripId')({ component: TripPage });

/** Trip detail: stops in sequence with outcomes, proof of delivery, loader flags and driver reports. */
function TripPage() {
  const { tripId } = Route.useParams();
  const q = useQuery({ queryKey: ['plans', 'trip', tripId], queryFn: () => get<TripDetailDto>(`/dispatcher/trips/${tripId}`) });
  const t = q.data;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Dispatcher', to: '/dispatcher' }, { label: 'Plan board', to: '/dispatcher/plan' }, { label: t?.key ?? 'Trip' }]} />
      <PageHeader title={t ? `Trip ${t.key}` : 'Trip'} subtitle={t ? `${t.brand}, ${t.district}. ${t.depot} depot. Driver ${t.driverName ?? 'not assigned'}.` : undefined} />
      {q.isPending ? (
        <SkeletonCards count={2} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : t ? (
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="flex flex-col gap-4">
            <TripCard t={t} />
            {t.problems.map((p) => (
              <Card key={p.id} className="p-4 text-[14px]">
                <p className="m-0 font-semibold text-danger">
                  {p.kind.replace('_', ' ')} at {hhmm(p.at)}
                  {p.delayMin ? `, about ${p.delayMin} min` : ''}
                </p>
                <p className="m-0 text-muted">{p.note}</p>
              </Card>
            ))}
          </div>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {t.stops.map((s) => (
              <li key={s.id}>
                <Card className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-brand-ink">
                      {s.seq}. {s.outlet.name} ({s.outlet.outletId})
                    </span>
                    <StopPill status={s.status} />
                  </div>
                  <p className="m-0 text-[14px] text-muted">
                    {s.order.ref}, {load(s.order.weightKg, s.order.volumeM3)}. Window {s.outlet.windowOpen} to {s.outlet.windowClose}. Planned {s.plannedArrival}
                    {s.eta ? `, estimated ${s.eta}` : ''}
                    {s.late ? ' (late risk)' : ''}.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {s.order.temp === 'chilled' && <ChilledChip />}
                    {s.outlet.parkingConstraint === 'van_only' && <VanChip />}
                    {s.outlet.mallWindow && <MallChip window={s.outlet.mallWindow} />}
                  </div>
                  {s.completedAt && (
                    <p className="m-0 text-[14px]">
                      {s.status === 'failed' ? `Not delivered at ${hhmm(s.completedAt)}: ${FAILURE_REASON_LABEL[s.failureReason!]}` : `Delivered ${hhmm(s.completedAt)}${s.status === 'partial' ? `, ${s.deliveredUnits} of ${s.order.units} units` : ''}${s.recipientName ? `, received by ${s.recipientName}` : ''}`}.
                    </p>
                  )}
                  {s.flags.map((f) => (
                    <p key={f.id} className="m-0 text-[14px] text-warn">
                      Loader flagged {f.unitsAffected} units {f.kind === 'shortfall' ? 'missing' : 'damaged'} at {hhmm(f.at)}. {f.note}
                    </p>
                  ))}
                  {s.photoUrl && <img src={s.photoUrl} alt={`Proof of delivery for ${s.order.ref}`} className="max-h-60 rounded-control border border-line object-contain" loading="lazy" />}
                </Card>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </>
  );
}
