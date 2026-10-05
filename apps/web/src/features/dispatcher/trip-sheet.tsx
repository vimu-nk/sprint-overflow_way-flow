import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { OrderDto, TripDetailDto } from '@wayflow/shared';
import { Button } from '@/components/ui/button';
import { ChilledChip, MallChip, VanChip } from '@/components/ui/chip';
import { Dialog } from '@/components/ui/dialog';
import { StopPill } from '@/components/ui/pill';
import { SkeletonRows } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { get } from '@/lib/api';
import { fmtInt, load } from '@/lib/format';

/** Stop list of one trip with a Move action per order (planning workspace detail). */
export function TripSheet({ tripId, onClose, onMove, editable }: { tripId: string | null; onClose: () => void; onMove: (o: OrderDto) => void; editable: boolean }) {
  const q = useQuery({ queryKey: ['plans', 'trip', tripId], queryFn: () => get<TripDetailDto>(`/dispatcher/trips/${tripId}`), enabled: !!tripId });
  const orders = useQuery({ queryKey: ['orders', q.data?.runDate], queryFn: () => get<{ orders: OrderDto[] }>(`/dispatcher/orders?date=${q.data!.runDate}`), enabled: !!q.data });
  const t = q.data;
  return (
    <Dialog open={!!tripId} onClose={onClose} title={t ? `${t.key} · ${t.brand}, ${t.district}` : 'Trip'} wide>
      {q.isPending ? (
        <SkeletonRows rows={5} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : t ? (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[14px] text-muted">
            Departs {t.depart}, back {t.back}. Trip time {fmtInt(t.tripMin)} min ({t.budget.kind === 'fresh' ? 'Fresh budget 270' : 'Style + Tech budget 480'}). Driver {t.driverName ?? 'not assigned'}.{' '}
            <Link to="/dispatcher/trips/$tripId" params={{ tripId: t.id }}>
              Open trip page
            </Link>
          </p>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {t.stops.map((s) => {
              const o = orders.data?.orders.find((x) => x.id === s.order.id);
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-card border border-line p-3">
                  <span className="grid size-7 place-items-center rounded-full bg-chip text-[13px] font-semibold">{s.seq}</span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 font-medium text-ink">
                      {s.order.ref} · {s.outlet.name} ({s.outlet.outletId})
                    </p>
                    <p className="m-0 text-[13px] text-muted">
                      {load(s.order.weightKg, s.order.volumeM3)}. Window {s.outlet.windowOpen} to {s.outlet.windowClose}. Planned {s.plannedArrival}
                      {s.late ? ' (late risk)' : ''}.
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {s.order.temp === 'chilled' && <ChilledChip />}
                      {s.outlet.parkingConstraint === 'van_only' && <VanChip />}
                      {s.outlet.mallWindow && <MallChip window={s.outlet.mallWindow} />}
                    </div>
                  </div>
                  <StopPill status={s.status} />
                  {editable && o && !['departed', 'completed'].includes(t.status) && (
                    <Button size="sm" variant="secondary" onClick={() => onMove(o)}>
                      Move
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </Dialog>
  );
}
