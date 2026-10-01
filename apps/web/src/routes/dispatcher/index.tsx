import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { ExceptionDto, LiveDto, TripDto } from '@wayflow/shared';
import { WifiOff } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/shell/app-shell';
import { Banner } from '@/components/ui/banner';
import { Card, CardTitle } from '@/components/ui/card';
import { ChilledChip } from '@/components/ui/chip';
import { Gauge } from '@/components/ui/gauge';
import { Pill, TripPill } from '@/components/ui/pill';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ExceptionPanel } from '@/features/dispatcher/exception-panel';
import { dateSearch, useRunDate } from '@/features/dispatcher/run-date';
import { vehicleLabel } from '@/features/dispatcher/trip-card';
import { get } from '@/lib/api';
import { colomboDate, dayMonth, fmtInt, fmt1, hhmm, longDate } from '@/lib/format';

export const Route = createFileRoute('/dispatcher/')({ validateSearch: dateSearch, component: Live });

const stateTone = (e: ExceptionDto) => (e.resolvedAt ? 'success' : e.severity === 'critical' ? 'danger' : 'warning');
const stateLabel = (e: ExceptionDto) => (e.resolvedAt ? 'Issue resolved' : e.severity === 'critical' ? 'Act now' : 'Act soon');

/** D4 Live tracking: KPIs, allocation progress, exceptions and active trips (D-07). */
function Live() {
  const runDate = useRunDate(Route.useSearch().date);
  const [selected, setSelected] = useState<string | null>(null);
  const [exception, setException] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['live', runDate], queryFn: () => get<LiveDto>(`/dispatcher/live?date=${runDate}`), enabled: !!runDate, refetchInterval: 60_000 });
  const d = q.data;
  const trip = d?.activeTrips.find((t) => t.id === selected) ?? d?.activeTrips[0];
  const reconnected = d?.exceptions.find((e) => e.type === 'vehicle_offline' && e.resolvedAt && Date.parse(d.now) - Date.parse(e.resolvedAt) < 30 * 60_000);
  return (
    <>
      <PageHeader title="Live Tracking" subtitle={d ? (colomboDate(d.now) === d.runDate ? `${longDate(d.runDate)}, ${hhmm(d.now)}. Peliyagoda and Kandy depots.` : `${longDate(d.runDate)} run. Now ${dayMonth(colomboDate(d.now))}, ${hhmm(d.now)}. Peliyagoda and Kandy depots.`) : <Spinner />} />
      {q.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32 rounded-card" />)}</div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : d ? (
        <div className="flex flex-col gap-6">
          {reconnected && (
            <Banner tone="success" title={`${reconnected.vehicleId} signal is back`}>
              {reconnected.resolution}. Queued records from the vehicle have synced.
            </Banner>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Orders on run" value={d.kpis.ordersOnRun} note={`${d.kpis.delivered} delivered, ${d.kpis.scheduled} scheduled`} />
            <Kpi label="Trips today" value={d.kpis.tripsToday} note={`${d.kpis.tripsCompleted} completed, ${d.kpis.tripsOnRoad} on the road`} />
            <Kpi label="Deferred today" value={d.kpis.deferred} note={d.kpis.deferredRefs.join(', ') || 'None'} pill={d.kpis.deferred ? <Pill tone="warning">Deferred</Pill> : undefined} to="/dispatcher/deferrals" />
            <Kpi label="Open exceptions" value={d.kpis.openExceptions} note={d.kpis.openExceptionTitles.join(', ') || 'None'} pill={d.kpis.openExceptions ? <Pill tone={d.exceptions.some((e) => !e.resolvedAt && e.severity === 'critical') ? 'danger' : 'warning'}>{d.exceptions.some((e) => !e.resolvedAt && e.severity === 'critical') ? 'Act now' : 'Act soon'}</Pill> : undefined} to="/dispatcher/exceptions" />
          </div>
          <Progress d={d} />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card className="p-5">
              <CardTitle>Recent Exceptions ({d.exceptions.filter((e) => !e.resolvedAt).length})</CardTitle>
              {d.exceptions.length === 0 ? (
                <p className="mt-4 mb-0 text-muted">No exceptions on this run.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-left text-[14px]">
                    <thead>
                      <tr className="bg-canvas text-[12px] tracking-wide text-muted uppercase">
                        <th className="px-3 py-2.5 font-semibold">Exception</th>
                        <th className="px-3 py-2.5 font-semibold">Vehicle</th>
                        <th className="px-3 py-2.5 font-semibold">Raised</th>
                        <th className="px-3 py-2.5 font-semibold">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.exceptions.slice(0, 8).map((e) => (
                        <tr key={e.id} className="border-b border-line align-top">
                          <td className="px-3 py-3">
                            {e.code.startsWith('LIVE') ? (
                              <span className="font-semibold text-link">{e.title}</span>
                            ) : (
                              <button type="button" className="font-semibold text-link hover:underline" onClick={() => setException(e.id)}>
                                {e.title}
                              </button>
                            )}
                            <p className="m-0 text-[13px] text-muted">{e.body}</p>
                          </td>
                          <td className="px-3 py-3">{e.vehicleId ?? '—'}</td>
                          <td className="px-3 py-3">{hhmm(e.raisedAt)}</td>
                          <td className="px-3 py-3">
                            <Pill tone={stateTone(e)}>{stateLabel(e)}</Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card className="p-5">
              <CardTitle>Active Trips ({d.activeTrips.length})</CardTitle>
              {d.activeTrips.length === 0 ? (
                <div className="mt-4">
                  <EmptyState title="No trips on the road" body="Trips show here once loading starts." />
                </div>
              ) : (
                <>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[380px] border-collapse text-left text-[14px]">
                      <thead>
                        <tr className="bg-canvas text-[12px] tracking-wide text-muted uppercase">
                          <th className="px-2 py-2.5 font-semibold">Trip</th>
                          <th className="px-2 py-2.5 font-semibold">Stops</th>
                          <th className="px-2 py-2.5 font-semibold">Return</th>
                          <th className="px-2 py-2.5 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.activeTrips.map((t) => (
                          <ActiveRow key={t.id} t={t} selected={trip?.id === t.id} onSelect={() => setSelected(t.id)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {trip && <TripLimits t={trip} />}
                </>
              )}
            </Card>
          </div>
        </div>
      ) : null}
      <ExceptionPanel id={exception} onClose={() => setException(null)} />
    </>
  );
}

function Kpi({ label, value, note, pill, to }: { label: string; value: number; note: string; pill?: React.ReactNode; to?: string }) {
  const body = (
    <Card className="flex h-full flex-col gap-1 p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-semibold tracking-wide text-muted uppercase">{label}</span>
        {pill}
      </div>
      <span className="text-[32px] leading-10 font-semibold text-brand-ink">{value}</span>
      <span className="truncate text-[13px] text-muted">{note}</span>
    </Card>
  );
  return to ? (
    <Link to={to} className="no-underline">
      {body}
    </Link>
  ) : (
    body
  );
}

function Progress({ d }: { d: LiveDto }) {
  const p = d.progress;
  const total = Math.max(1, p.allocated + p.loading + p.inTransit + p.delivered);
  const seg = [
    { label: 'Allocated', n: p.allocated, color: 'bg-brand' },
    { label: 'Loading', n: p.loading, color: 'bg-warn-bright' },
    { label: 'In transit', n: p.inTransit, color: 'bg-info' },
    { label: 'Delivered', n: p.delivered, color: 'bg-ok-bright' },
  ];
  return (
    <Card className="p-5">
      <CardTitle>Today&apos;s Allocation Progress</CardTitle>
      <div className="mt-4 flex h-6 overflow-hidden rounded-[4px] bg-chip" role="img" aria-label={seg.map((s) => `${s.label} ${s.n}`).join(', ')}>
        {seg.map((s) => (s.n ? <div key={s.label} className={s.color} style={{ width: `${(100 * s.n) / total}%` }} /> : null))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[14px]">
        {seg.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${s.color}`} aria-hidden /> {s.label} ({s.n})
          </span>
        ))}
      </div>
      <p className="mt-3 mb-0 text-[13px] text-muted">
        Not in the bar: {d.kpis.deferred} deferred, {p.partial} partly delivered, {p.issues} issue reported{p.failed ? `, ${p.failed} not delivered` : ''}.
        {p.stale ? ` ${p.stale} trip${p.stale > 1 ? 's have' : ' has'} no signal; their stops are projected from the plan.` : ''}
      </p>
    </Card>
  );
}

function ActiveRow({ t, selected, onSelect }: { t: TripDto; selected: boolean; onSelect: () => void }) {
  return (
    <tr className={`border-b border-line align-top ${selected ? 'bg-canvas' : ''}`}>
      <td className="px-2 py-3">
        <button type="button" onClick={onSelect} className="font-semibold text-link hover:underline">
          {t.key}
        </button>
        {t.stale ? (
          <p className="m-0 flex items-center gap-1 text-[13px] text-warn">
            <WifiOff className="size-3.5" aria-hidden /> No signal since {hhmm(t.lastSignalAt)}
          </p>
        ) : (
          <p className="m-0 text-[13px] text-muted">
            {t.brand}, {t.district}
          </p>
        )}
      </td>
      <td className="px-2 py-3">
        {t.stopsDone} of {t.stopCount}
      </td>
      <td className="px-2 py-3">{t.back}</td>
      <td className="px-2 py-3">
        {t.lateRisk && t.status === 'departed' ? <Pill tone="warning">Late risk</Pill> : <TripPill status={t.status} />}
        {t.stale && <p className="m-0 mt-1 text-[12px] text-muted">Last update {hhmm(t.lastSignalAt)}</p>}
      </td>
    </tr>
  );
}

function TripLimits({ t }: { t: TripDto }) {
  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-brand-ink">{t.key} Limits</span>
        <span className="text-[13px] text-muted">Trip {t.tripNo} of 2 allowed today</span>
      </div>
      {t.vehicleTemp === 'reefer' && (
        <div>
          <ChilledChip label={`Chilled, ${vehicleLabel(t)}`} />
        </div>
      )}
      <Gauge label="Weight" value={`${fmtInt(t.weight.used)} / ${fmtInt(t.weight.cap)} kg`} ratio={t.weight.used / t.weight.cap} />
      <Gauge label="Volume" value={`${fmt1(t.volume.used)} / ${fmt1(t.volume.cap)} m³`} ratio={t.volume.used / t.volume.cap} />
      <Gauge label={`Trip time${t.reportedDelayMin ? ', plan' : ''} (${t.budget.kind === 'fresh' ? 'Fresh' : 'Style + Tech'} budget)`} value={`${fmtInt(t.budget.used)} / ${t.budget.cap} min`} ratio={t.budget.used / t.budget.cap} />
      {t.reportedDelayMin > 0 && <p className="m-0 text-[13px] text-warn">Reported delay: about {t.reportedDelayMin} min. Arrival estimates include it.</p>}
    </div>
  );
}
