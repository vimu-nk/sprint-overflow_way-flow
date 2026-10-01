import { createFileRoute, Link } from '@tanstack/react-router';
import type { TripDetailDto } from '@wayflow/shared';
import { Check, Clock3, Flag } from 'lucide-react';
import { FieldShell } from '@/components/shell/field-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChilledChip, Chip, MallChip } from '@/components/ui/chip';
import { TripPill } from '@/components/ui/pill';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { PlanChanged } from '@/features/field/changes';
import { TripLimits } from '@/features/field/limits';
import { cn } from '@/lib/cn';
import { fmt1, fmtInt, hhmm } from '@/lib/format';
import { notify } from '@/lib/notify';
import { applyOverlay, overlay, useFieldData, useOutbox } from '@/lib/offline/field-data';
import { enqueue } from '@/lib/offline/sync';

export const Route = createFileRoute('/loader/trips/$tripId')({ component: LoadList });

/** L2 Load list: loading order = reverse of the stop sequence (L-02), tick or flag each order, then Mark loaded (L-06). */
function LoadList() {
  const { me } = Route.useRouteContext();
  const { tripId } = Route.useParams();
  const q = useFieldData<TripDetailDto>(me, ['loader-trip', tripId], `/loader/trips/${tripId}`);
  const outbox = useOutbox(me.id);
  const ov = overlay(outbox);
  const t = q.data ? applyOverlay(q.data.data, ov) : null;
  const loadOrder = t ? [...t.stops].sort((a, b) => b.seq - a.seq) : [];
  const flagged = (id: string) => !!t?.stops.find((s) => s.id === id)?.flags.length || !!ov.stops.get(id)?.flagged;
  const done = loadOrder.filter((s) => s.loaded || flagged(s.id)).length;
  const removed = t?.changes.filter((c) => c.from === t.key && c.change !== 'added') ?? [];
  const locked = t ? ['departed', 'completed'].includes(t.status) : true;

  const toggle = async (stopId: string, loaded: boolean) => {
    await enqueue({ type: 'load.check', tripId, stopId, loaded });
  };
  const ready = async () => {
    await enqueue({ type: 'load.ready', tripId });
    notify.success(navigator.onLine ? 'Marked loaded' : 'Marked loaded on this device', navigator.onLine ? 'The driver can start the trip.' : 'It sends when signal returns.');
  };

  return (
    <FieldShell
      me={me}
      syncTo="/loader"
      place={me.depot ? `${me.depot === 'Kandy' ? 'Kandy hub' : 'Peliyagoda DC'} dock` : undefined}
      offlineText="Ticks are saved on this device and send when signal returns."
      bottom={
        t && !locked ? (
          <Button size="xl" block onClick={() => void ready()} disabled={done < loadOrder.length || t.status === 'ready'}>
            {t.status === 'ready' ? 'Loaded and ready' : done < loadOrder.length ? `Mark loaded (${done} of ${loadOrder.length})` : 'Mark loaded'}
          </Button>
        ) : undefined
      }
    >
      <Breadcrumbs items={[{ label: "Today's loads", to: '/loader' }, { label: t?.key ?? 'Trip' }]} />
      {q.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-56" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : t ? (
        <>
          <PlanChanged t={t} role="loader" doNotLoad />
          {q.data?.fromCache && <Banner tone="offline" title={`Load list saved at ${hhmm(q.data.savedAt)}`} className="mb-4">It refreshes when the connection returns.</Banner>}
          <div className="flex items-start justify-between gap-3">
            <h1 className="m-0 text-[28px] leading-9 font-bold text-brand-ink">Load {t.key}</h1>
            <TripPill status={t.status} />
          </div>
          <p className="mt-1 mb-4 text-[15px] text-muted">
            {t.depot} depot, {t.brand} {t.vehicleType === 'van' ? 'van' : 'truck'}
            {t.vehicleTemp === 'reefer' ? ' (refrigerated)' : ''}.
          </p>
          <div className="grid gap-4 md:grid-cols-[1fr_300px]">
            <section aria-labelledby="order-h">
              <h2 id="order-h" className="mt-0 mb-3 text-[17px] font-semibold text-brand-ink">
                Load in this order, last stop first
              </h2>
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {loadOrder.map((s, i) => {
                  const pending = ov.stops.get(s.id)?.pending;
                  const isFlagged = flagged(s.id);
                  const flag = s.flags[0];
                  return (
                    <li key={s.id}>
                      <Card className={cn('flex items-start gap-3 p-4', s.loaded && 'border-brand/40 bg-brand-tint/40')}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={s.loaded}
                          aria-label={`Loaded ${s.order.ref}`}
                          disabled={locked}
                          onClick={() => void toggle(s.id, !s.loaded)}
                          className={cn('grid size-12 shrink-0 place-items-center rounded-control border-2', s.loaded ? 'border-brand bg-brand text-white' : 'border-field bg-white')}
                        >
                          {s.loaded && <Check className="size-6" aria-hidden />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{s.outlet.outletId}</span>
                            <span>{s.outlet.name}</span>
                            {pending && (
                              <Chip tone="warning" icon={<Clock3 className="size-3.5" aria-hidden />}>
                                Not synced yet
                              </Chip>
                            )}
                          </div>
                          <p className="m-0 mt-1 text-[14px] text-muted">
                            Load {i + 1} of {loadOrder.length}, {s.order.ref}, {fmtInt(s.order.weightKg)} kg, {fmt1(s.order.volumeM3)} m³, window {s.outlet.windowOpen} to {s.outlet.windowClose}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {s.order.temp === 'chilled' && <ChilledChip label="Chilled: keep cold" />}
                            {t.brand === 'Tech' && <Chip>Fragile, high value</Chip>}
                            {s.outlet.mallWindow && <MallChip window={s.outlet.mallWindow} />}
                          </div>
                          {isFlagged ? (
                            <p className="m-0 mt-2 text-[14px] font-medium text-warn">{flag ? `${flag.unitsAffected} units ${flag.kind === 'shortfall' ? 'missing' : 'damaged'} reported. ${s.order.units - flag.unitsAffected} units go out.` : 'Shortfall reported on this device.'}</p>
                          ) : (
                            !locked && (
                              <Link to="/loader/flag/$tripId/$stopId" params={{ tripId, stopId: s.id }} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium">
                                <Flag className="size-4" aria-hidden /> Report missing or damaged
                              </Link>
                            )
                          )}
                        </div>
                      </Card>
                    </li>
                  );
                })}
                {removed.map((c) => (
                  <li key={c.ref}>
                    <Card className="p-4 opacity-80">
                      <p className="m-0 font-semibold line-through">
                        {c.outletId} {c.outletName}
                      </p>
                      <p className="m-0 text-[14px] text-warn">
                        Removed from this trip.{c.to ? ` Now on ${c.to}.` : ''} {c.ref}, {fmtInt(c.weightKg)} kg, {fmt1(c.volumeM3)} m³.
                      </p>
                    </Card>
                  </li>
                ))}
              </ol>
            </section>
            <aside className="flex flex-col gap-2">
              <TripLimits t={t} title="Trip Limits" />
              <p className="m-0 text-[14px] text-muted">
                Trip {t.tripNo} of max 2. Departs {t.depart}, back {t.back}.
              </p>
            </aside>
          </div>
        </>
      ) : null}
    </FieldShell>
  );
}
