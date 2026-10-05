import { createFileRoute, Link } from '@tanstack/react-router';
import type { LoaderTripsDto } from '@wayflow/shared';
import { ChevronRight } from 'lucide-react';
import { FieldShell } from '@/components/shell/field-shell';
import { Banner } from '@/components/ui/banner';
import { ChilledChip, VanChip } from '@/components/ui/chip';
import { TripPill } from '@/components/ui/pill';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { formatDate } from '@wayflow/shared';
import { hhmm } from '@/lib/format';
import { useFieldData } from '@/lib/offline/field-data';

export const Route = createFileRoute('/loader/')({ component: Loads });

/** L1 Today's loads: trips for the loader's depot, in departure order (L-01). */
function Loads() {
  const { me } = Route.useRouteContext();
  const q = useFieldData<LoaderTripsDto>(me, ['loads'], '/loader/trips');
  const d = q.data?.data;
  return (
    <FieldShell me={me} syncTo="/loader" place={me.depot ? `${me.depot === 'Kandy' ? 'Kandy hub' : 'Peliyagoda DC'} dock` : undefined} offlineText="Ticks are saved on this device and send when signal returns.">
      <h1 className="m-0 text-[28px] leading-9 font-bold text-brand-ink">Today&apos;s Loads</h1>
      <div className="mt-1 mb-5 text-[15px] text-muted">{d ? `${d.depot} depot. ${d.runDate ? formatDate(d.runDate) : 'No published run'}. ${d.trips.length} trips.` : <Skeleton className="h-5 w-64" />}</div>
      {q.data?.fromCache && (
        <Banner tone="offline" title={`Showing the list saved at ${hhmm(q.data.savedAt)}`} className="mb-4">
          It refreshes when the connection returns.
        </Banner>
      )}
      {q.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-card" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !d?.trips.length ? (
        <EmptyState title="Waiting for the plan" body="Trips appear here once the dispatcher publishes the plan for your depot." />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {d.trips.map((t) => (
            <li key={t.id}>
              <Link to="/loader/trips/$tripId" params={{ tripId: t.id }} className="flex min-h-[72px] items-center gap-3 rounded-card border border-line bg-white p-4 text-ink no-underline hover:border-field">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[17px] font-semibold">{t.key}</span>
                    {t.chilled && <ChilledChip />}
                    {t.vanOnly && <VanChip />}
                  </div>
                  <p className="m-0 mt-1 text-[14px] text-muted">
                    {t.depart} to {t.back}, {t.brand}, {t.stopCount} stop{t.stopCount === 1 ? '' : 's'}
                    {t.status === 'loading' ? `. ${t.loadedCount} of ${t.stopCount} loaded` : ''}
                    {t.stale ? `. Last update ${hhmm(t.lastSignalAt)}` : ''}
                  </p>
                </div>
                <TripPill status={t.status} issue={t.hasShortfall && ['loading', 'ready'].includes(t.status) ? 'Short-loaded' : null} />
                <ChevronRight className="size-5 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </FieldShell>
  );
}
