import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { ExceptionDto } from '@wayflow/shared';
import { useState } from 'react';
import { PageHeader } from '@/components/shell/app-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ExceptionPanel } from '@/features/dispatcher/exception-panel';
import { dateSearch, useRunDate } from '@/features/dispatcher/run-date';
import { get } from '@/lib/api';
import { hhmm, longDate } from '@/lib/format';

export const Route = createFileRoute('/dispatcher/exceptions/')({ validateSearch: dateSearch, component: Exceptions });

/** All exceptions on the run: shortfalls, failed stops, receipt issues, road problems, plan changes. */
function Exceptions() {
  const runDate = useRunDate(Route.useSearch().date);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const q = useQuery({ queryKey: ['exceptions', runDate], queryFn: () => get<ExceptionDto[]>(`/dispatcher/exceptions?date=${runDate}`), enabled: !!runDate });
  const rows = (q.data ?? []).filter((e) => filter === 'all' || !e.resolvedAt);
  return (
    <>
      <Breadcrumbs items={[{ label: 'Dispatcher', to: '/dispatcher' }, { label: 'Exceptions' }]} />
      <PageHeader title="Exceptions" subtitle={runDate ? `${longDate(runDate)} run. Problems raised by loaders, drivers and stores.` : undefined} />
      <div className="mb-4 flex gap-2" role="tablist">
        {(['open', 'all'] as const).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`min-h-11 rounded-control px-4 text-[15px] font-medium ${filter === f ? 'bg-brand-tint text-brand' : 'text-muted hover:bg-chip'}`}>
            {f === 'open' ? 'Open' : 'All'}
          </button>
        ))}
      </div>
      {q.isPending ? (
        <Card className="p-5">
          <SkeletonRows />
        </Card>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={filter === 'open' ? 'No open exceptions' : 'No exceptions on this run'} body="Shortfalls, failed deliveries and receipt issues appear here as soon as they are raised." />
      ) : (
        <Card className="divide-y divide-line">
          {rows.map((e) => (
            <button key={e.id} type="button" onClick={() => setOpen(e.id)} className="flex w-full flex-wrap items-start gap-3 p-4 text-left hover:bg-canvas">
              <span className="w-24 shrink-0 text-[13px] text-muted">{e.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-link">{e.title}</span>
                <span className="block text-[14px] text-muted">{e.body}</span>
              </span>
              <span className="text-[14px]">{e.vehicleId ?? ''}</span>
              <span className="text-[14px]">{hhmm(e.raisedAt)}</span>
              <Pill tone={e.resolvedAt ? 'success' : e.severity === 'critical' ? 'danger' : 'warning'}>{e.resolvedAt ? 'Issue resolved' : e.severity === 'critical' ? 'Act now' : 'Act soon'}</Pill>
            </button>
          ))}
        </Card>
      )}
      <ExceptionPanel id={open} onClose={() => setOpen(null)} />
    </>
  );
}
