import { createFileRoute, Link } from '@tanstack/react-router';
import type { TripDetailDto } from '@wayflow/shared';
import { Camera } from 'lucide-react';
import { useState } from 'react';
import { FieldShell } from '@/components/shell/field-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Segmented } from '@/components/ui/form';
import { Pill } from '@/components/ui/pill';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { hhmm } from '@/lib/format';
import { useFieldData, useOutbox } from '@/lib/offline/field-data';
import { compressPhoto, enqueue } from '@/lib/offline/sync';

export const Route = createFileRoute('/loader/flag/$tripId/$stopId')({ component: Shortfall });

/** L3 Report shortfall or damage before departure (L-04, L-05). */
function Shortfall() {
  const { me } = Route.useRouteContext();
  const { tripId, stopId } = Route.useParams();
  const q = useFieldData<TripDetailDto>(me, ['loader-trip', tripId], `/loader/trips/${tripId}`);
  const outbox = useOutbox(me.id);
  const [kind, setKind] = useState<'shortfall' | 'damaged'>('shortfall');
  const [units, setUnits] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = q.data?.data;
  const s = t?.stops.find((x) => x.id === stopId);
  const sent = outbox.find((o) => o.clientActionId === sentId);
  const status = !sent ? null : sent.status === 'applied' ? 'sent' : sent.status === 'rejected' ? 'rejected' : 'queued';

  const send = async () => {
    const n = Number(units);
    if (!s) return;
    if (!Number.isInteger(n) || n < 1 || n > s.order.units) return setError(`Enter 1 to ${s.order.units} units.`);
    setError(null);
    const item = await enqueue({ type: 'load.flag', tripId, stopId, kind, unitsAffected: n, note: note || undefined, hasPhoto: !!photo }, photo ? { blob: photo, entityType: 'flag' } : undefined);
    setSentId(item.clientActionId);
  };
  const raisedAt = sent ? hhmm(sent.createdAtClient) : null;
  return (
    <FieldShell
      me={me}
      syncTo="/loader"
      place={me.depot ? `${me.depot === 'Kandy' ? 'Kandy hub' : 'Peliyagoda DC'} dock` : undefined}
      offlineText="Report saved on this device. It sends when signal returns."
      bottom={
        status ? (
          <Link to="/loader/trips/$tripId" params={{ tripId }}>
            <Button size="xl" block variant="secondary">
              Back to loads
            </Button>
          </Link>
        ) : (
          <Button size="xl" block onClick={() => void send()} disabled={!s}>
            Send report
          </Button>
        )
      }
    >
      <Breadcrumbs items={[{ label: "Today's loads", to: '/loader' }, { label: t?.key ?? 'Trip', to: `/loader/trips/${tripId}` }, { label: 'Report shortfall' }]} />
      {q.isPending ? (
        <Skeleton className="h-80 rounded-card" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !t || !s ? (
        <ErrorState error={null} />
      ) : (
        <div className="flex flex-col gap-4">
          {status === 'sent' && (
            <Banner tone="success" title={`Sent at ${hhmm(sent!.sentAt)}`} live>
              The dispatcher and the store have been told. {s.order.units - Number(units)} units go out.
            </Banner>
          )}
          {status === 'queued' && (
            <Banner tone="offline" title="Saved on this device" live>
              Report saved on this device. It sends when signal returns.
            </Banner>
          )}
          {status === 'rejected' && <Banner tone="danger" title="Not accepted">{sent?.message}</Banner>}
          <div className="flex items-start justify-between gap-3">
            <h1 className="m-0 text-[28px] leading-9 font-bold text-brand-ink">Report Shortfall</h1>
            <Pill tone={status === 'sent' ? 'warning' : status === 'queued' ? 'warning' : 'info'}>{status === 'sent' ? 'Short-loaded' : status === 'queued' ? 'Not synced yet' : 'Loading'}</Pill>
          </div>
          <p className="-mt-2 mb-0 text-[15px] text-muted">
            {t.depot} depot, {t.vehicleId}.
          </p>
          <div className="grid gap-4 md:grid-cols-[1fr_300px]">
            <Card className="flex flex-col gap-4 p-4">
              <Segmented
                label="What is wrong"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'shortfall', label: 'Missing' },
                  { value: 'damaged', label: 'Damaged' },
                ]}
              />
              <Field label="Units ordered" htmlFor="sf-ordered">
                <Input id="sf-ordered" value={String(s.order.units)} readOnly big />
              </Field>
              <Field label={kind === 'shortfall' ? 'Units missing' : 'Units damaged'} htmlFor="sf-units" error={error}>
                <Input id="sf-units" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, '').slice(0, 4))} disabled={!!status} big autoFocus />
              </Field>
              <Field label="Note (optional)" htmlFor="sf-note">
                <Input id="sf-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={!!status} maxLength={280} big />
              </Field>
              {!status && (
                <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-control border border-dashed border-field px-4 text-[15px]">
                  <Camera className="size-5 text-muted" aria-hidden />
                  {photo ? 'Photo attached' : 'Add photo'}
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={async (e) => e.target.files?.[0] && setPhoto(await compressPhoto(e.target.files[0]))} />
                </label>
              )}
              {status && Number(units) > 0 && (
                <p className="m-0 text-[15px]">
                  Raised {raisedAt}. {units} of {s.order.units} {s.order.temp} units {kind === 'shortfall' ? 'missing' : 'damaged'} at the {t.depot} dock.
                </p>
              )}
            </Card>
            <Card className="flex flex-col gap-2 p-4">
              <h2 className="m-0 text-[17px] font-semibold text-brand-ink">This Load</h2>
              <dl className="m-0 grid grid-cols-[80px_1fr] gap-y-2 text-[15px]">
                <dt className="text-muted">Vehicle</dt>
                <dd className="m-0">
                  {t.vehicleId}, {t.vehicleTemp === 'reefer' ? 'reefer ' : ''}
                  {t.vehicleType}
                </dd>
                <dt className="text-muted">Store</dt>
                <dd className="m-0">
                  {s.outlet.outletId} {s.outlet.name}
                </dd>
                <dt className="text-muted">Order</dt>
                <dd className="m-0">{s.order.ref}</dd>
                <dt className="text-muted">Type</dt>
                <dd className="m-0 capitalize">{s.order.temp}</dd>
              </dl>
            </Card>
          </div>
        </div>
      )}
    </FieldShell>
  );
}
