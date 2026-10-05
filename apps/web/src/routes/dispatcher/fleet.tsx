import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { FleetVehicleDto } from '@wayflow/shared';
import { useState } from 'react';
import { PageHeader } from '@/components/shell/app-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChilledChip, Chip } from '@/components/ui/chip';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { Gauge } from '@/components/ui/gauge';
import { Pill } from '@/components/ui/pill';
import { SkeletonCards } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { dateSearch, useRunDate } from '@/features/dispatcher/run-date';
import { get, put } from '@/lib/api';
import { dayMonth, fmt1, fmtInt } from '@/lib/format';
import { notify } from '@/lib/notify';

export const Route = createFileRoute('/dispatcher/fleet')({ validateSearch: dateSearch, component: Fleet });

/** D-09 fleet availability and weekly fuel. Sending a planned vehicle to the workshop re-plans it (F14c). */
function Fleet() {
  const runDate = useRunDate(Route.useSearch().date);
  const qc = useQueryClient();
  const [target, setTarget] = useState<FleetVehicleDto | null>(null);
  const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['fleet', runDate], queryFn: () => get<FleetVehicleDto[]>(`/dispatcher/fleet?date=${runDate}`), enabled: !!runDate });
  const set = useMutation({
    mutationFn: (v: { vehicleId: string; status: 'available' | 'in_workshop' }) => put<{ replanned: boolean }>(`/dispatcher/fleet/${v.vehicleId}`, { date: runDate, status: v.status, note: note || undefined }),
    meta: { topLoader: true },
    onSuccess: (r, v) => {
      notify.success(v.status === 'in_workshop' ? `${v.vehicleId} is in the workshop` : `${v.vehicleId} is available`, r.replanned ? 'Its trips were re-planned and republished. The loader and driver have been told.' : undefined);
      setTarget(null);
      setNote('');
      ['fleet', 'plans', 'orders', 'live', 'deferrals'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => notify.fail(e, 'Could not change the vehicle'),
  });
  return (
    <>
      <Breadcrumbs items={[{ label: 'Dispatcher', to: '/dispatcher' }, { label: 'Fleet' }]} />
      <PageHeader title="Fleet" subtitle={runDate ? `Availability for the ${dayMonth(runDate)} run and fuel used this week.` : undefined} />
      {q.isPending ? (
        <SkeletonCards count={6} className="sm:grid-cols-2 xl:grid-cols-3" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        (['Peliyagoda', 'Kandy'] as const).map((depot) => (
          <section key={depot} className="mb-8">
            <h2 className="mt-0 mb-3 text-[18px] font-semibold text-brand-ink">
              {depot} ({q.data!.filter((v) => v.depot === depot && v.status === 'available').length} of {q.data!.filter((v) => v.depot === depot).length} available)
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {q.data!
                .filter((v) => v.depot === depot)
                .map((v) => (
                  <Card key={v.vehicleId} className="flex flex-col gap-2 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[17px] font-semibold text-brand-ink">{v.vehicleId}</span>
                      <Pill tone={v.status === 'available' ? 'success' : 'warning'}>{v.status === 'available' ? 'Available' : 'In workshop'}</Pill>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {v.temp === 'reefer' ? <ChilledChip label={v.type === 'van' ? 'Reefer van' : 'Reefer truck'} /> : <Chip>{v.type === 'van' ? 'Van' : 'Truck'}</Chip>}
                      <Chip>
                        {fmtInt(v.weightCapKg)} kg / {fmt1(v.volumeCapM3)} m³
                      </Chip>
                    </div>
                    <Gauge label="Fuel this week" value={`${fmt1(v.fuelUsedL)} / ${fmtInt(v.weeklyQuotaL)} L`} ratio={v.fuelUsedL / v.weeklyQuotaL} />
                    <p className="m-0 text-[13px] text-muted">
                      {v.trips.length ? `Trips: ${v.trips.join(', ')}` : 'No trips on this run'}. {v.driverName ? `Driver ${v.driverName}.` : ''}
                      {v.note ? ` ${v.note}.` : ''}
                    </p>
                    <Button variant="secondary" size="sm" onClick={() => (v.status === 'available' ? setTarget(v) : set.mutate({ vehicleId: v.vehicleId, status: 'available' }))}>
                      {v.status === 'available' ? 'Send to workshop' : 'Mark available'}
                    </Button>
                  </Card>
                ))}
            </div>
          </section>
        ))
      )}
      <Dialog open={!!target} onClose={() => setTarget(null)} title={`Send ${target?.vehicleId} to the workshop`}>
        <p className="mt-0 text-[15px]">{target?.trips.length ? `${target.trips.join(' and ')} will be re-planned onto other vehicles and the plan republished. Orders that no longer fit are deferred with a reason.` : 'This vehicle has no trips on this run.'}</p>
        <Field label="Note (optional)" htmlFor="ws-note">
          <Input id="ws-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Brake fault reported" maxLength={200} />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" loading={set.isPending} onClick={() => target && set.mutate({ vehicleId: target.vehicleId, status: 'in_workshop' })}>
            Send to workshop
          </Button>
        </div>
      </Dialog>
    </>
  );
}
