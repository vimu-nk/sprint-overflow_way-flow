import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { FAILURE_REASON_LABEL, FAILURE_REASONS, type FailureReason } from '@wayflow/shared';
import { Camera, Clock3 } from 'lucide-react';
import { useState } from 'react';
import { FieldShell } from '@/components/shell/field-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Field, Input, Segmented, Select } from '@/components/ui/form';
import { StopPill } from '@/components/ui/pill';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/states';
import { useRun } from '@/features/field/use-run';
import { fmt1, fmtInt, hhmm } from '@/lib/format';
import { notify } from '@/lib/notify';
import { useOutbox } from '@/lib/offline/field-data';
import { compressPhoto, enqueue } from '@/lib/offline/sync';

export const Route = createFileRoute('/driver/record/$stopId')({ component: Record });

type Outcome = 'delivered' | 'partial' | 'failed';

/** DR3 Record delivery with proof (R-02, R-03). Saved on the device first, synced when possible (R-04). */
function Record() {
  const { me } = Route.useRouteContext();
  const { stopId } = Route.useParams();
  const navigate = useNavigate();
  const { q, trips } = useRun(me);
  const outbox = useOutbox(me.id);
  const trip = trips.find((t) => t.stops.some((s) => s.id === stopId));
  const stop = trip?.stops.find((s) => s.id === stopId);
  const [outcome, setOutcome] = useState<Outcome>('delivered');
  const [recipient, setRecipient] = useState('');
  const [units, setUnits] = useState('');
  const [short, setShort] = useState('');
  const [reason, setReason] = useState<FailureReason | ''>('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = outbox.find((o) => o.clientActionId === savedId);

  const save = async () => {
    if (!stop) return;
    if (outcome === 'partial') {
      const n = Number(units);
      if (!Number.isInteger(n) || n < 0 || n >= stop.order.units) return setError(`Enter 0 to ${stop.order.units - 1} units delivered.`);
      if (!short.trim()) return setError('Say what was short.');
    }
    if (outcome === 'failed' && !reason) return setError('Choose a reason.');
    if (outcome !== 'failed' && !recipient.trim()) return setError('Enter who received the goods.');
    setError(null);
    let geo: { lat: number; lng: number } | undefined;
    // Optional location for proof of delivery; never blocks saving (specs/19 SEC-70).
    if (navigator.geolocation && outcome !== 'failed') {
      geo = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(undefined), 1500);
        navigator.geolocation.getCurrentPosition(
          (p) => (clearTimeout(timer), resolve({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 })),
          () => (clearTimeout(timer), resolve(undefined)),
          { maximumAge: 60_000, timeout: 1500 },
        );
      });
    }
    const item = await enqueue(
      {
        type: 'stop.outcome',
        stopId,
        outcome,
        deliveredUnits: outcome === 'partial' ? Number(units) : undefined,
        shortNote: outcome === 'partial' ? short : undefined,
        failureReason: outcome === 'failed' ? (reason as FailureReason) : undefined,
        recipientName: outcome !== 'failed' ? recipient : undefined,
        hasPhoto: !!photo,
        geo,
      },
      photo ? { blob: photo, entityType: 'stop' } : undefined,
    );
    if (navigator.onLine) {
      notify.success(outcome === 'failed' ? 'Saved as not delivered' : 'Delivery saved');
      void navigate({ to: '/driver' });
    } else {
      setSavedId(item.clientActionId);
    }
  };

  return (
    <FieldShell
      me={me}
      syncTo="/driver/sync"
      bottom={
        saved ? (
          <Link to="/driver">
            <Button size="xl" block variant="secondary">
              Back to run
            </Button>
          </Link>
        ) : stop ? (
          <Button size="xl" block onClick={() => void save()} disabled={trip?.status !== 'departed'}>
            Save delivery
          </Button>
        ) : undefined
      }
    >
      <Breadcrumbs items={[{ label: 'My run', to: '/driver' }, { label: 'Stop detail', to: `/driver/stops/${stopId}` }, { label: 'Record delivery' }]} />
      {q.isPending ? (
        <Skeleton className="h-96 rounded-card" />
      ) : !stop ? (
        <EmptyState title="Stop not found" body="Go back to your run." />
      ) : (
        <div className="flex flex-col gap-4">
          {saved && (
            <Banner tone="offline" title={`Offline. Saved on this device at ${hhmm(saved.createdAtClient)}`} live>
              It sends when signal returns.
            </Banner>
          )}
          <h1 className="m-0 text-[28px] leading-9 font-bold text-brand-ink">Record Delivery</h1>
          <p className="m-0 text-[16px] text-muted">
            {stop.outlet.name} ({stop.outlet.outletId}), {stop.order.ref}. {fmtInt(stop.order.weightKg)} kg, {fmt1(stop.order.volumeM3)} m³. Window {stop.outlet.windowOpen} to {stop.outlet.windowClose}.
          </p>
          {trip?.status !== 'departed' && <Banner tone="info" title="Start the trip first">Deliveries can be recorded once the trip has started.</Banner>}
          <div className="flex items-center gap-2 text-[16px]">
            <span className="text-muted">Status</span>
            {saved ? (
              <>
                <StopPill status={outcome} />
                <Chip tone="warning" icon={<Clock3 className="size-3.5" aria-hidden />}>
                  Not synced yet
                </Chip>
              </>
            ) : (
              <StopPill status={stop.status} />
            )}
          </div>
          <Card className="flex flex-col gap-4 p-4">
            <Segmented
              label="Outcome"
              value={outcome}
              onChange={(v) => !saved && setOutcome(v)}
              options={[
                { value: 'delivered', label: 'Delivered' },
                { value: 'partial', label: 'Partly delivered' },
                { value: 'failed', label: 'Not delivered' },
              ]}
            />
            {outcome === 'partial' && (
              <>
                <Field label="Units delivered" htmlFor="rd-units" hint={`${stop.order.units} units on this order.`}>
                  <Input id="rd-units" inputMode="numeric" placeholder="Enter units" value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, '').slice(0, 4))} disabled={!!saved} big />
                </Field>
                <Field label="What was short" htmlFor="rd-short">
                  <Input id="rd-short" placeholder="Enter a reason" value={short} onChange={(e) => setShort(e.target.value)} disabled={!!saved} maxLength={200} big />
                </Field>
              </>
            )}
            {outcome === 'failed' ? (
              <Field label="Reason" htmlFor="rd-reason">
                <Select id="rd-reason" value={reason} onChange={(e) => setReason(e.target.value as FailureReason)} disabled={!!saved} big>
                  <option value="">Choose a reason</option>
                  {FAILURE_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {FAILURE_REASON_LABEL[r]}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Received by" htmlFor="rd-recipient">
                <Input id="rd-recipient" placeholder="Store supervisor" value={recipient} onChange={(e) => setRecipient(e.target.value)} disabled={!!saved} maxLength={80} autoComplete="off" big />
              </Field>
            )}
            {outcome !== 'failed' && (
              <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-control border border-dashed border-field px-4 text-[16px]">
                <Camera className="size-5 text-muted" aria-hidden />
                {photo ? 'Photo attached' : 'Add photo'}
                <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={!!saved} onChange={async (e) => e.target.files?.[0] && setPhoto(await compressPhoto(e.target.files[0]))} />
              </label>
            )}
            {error && (
              <p role="alert" className="m-0 text-[15px] text-danger">
                {error}
              </p>
            )}
          </Card>
        </div>
      )}
    </FieldShell>
  );
}
