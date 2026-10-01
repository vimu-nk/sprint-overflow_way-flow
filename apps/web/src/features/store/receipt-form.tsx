import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OrderDto } from '@wayflow/shared';
import { Camera } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChilledChip, VanChip } from '@/components/ui/chip';
import { Field, Input } from '@/components/ui/form';
import { OrderPill } from '@/components/ui/pill';
import { api, post } from '@/lib/api';
import { fmtInt, hhmm } from '@/lib/format';
import { notify } from '@/lib/notify';
import { compressPhoto } from '@/lib/offline/sync';

/** SM3 Confirm receipt, with the "Report a problem" variant (S-07). */
export function ReceiptForm({ order, onDone }: { order: OrderDto; onDone?: () => void }) {
  const qc = useQueryClient();
  const delivered = order.deliveredUnits ?? order.units;
  const [mode, setMode] = useState<'confirm' | 'problem'>('confirm');
  const [received, setReceived] = useState(String(delivered));
  const [damaged, setDamaged] = useState('0');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      let attachmentId: string | undefined;
      if (photo) {
        const form = new FormData();
        form.append('entityType', 'receipt');
        form.append('entityId', order.id);
        form.append('clientAttachmentId', crypto.randomUUID());
        form.append('file', photo, 'photo.jpg');
        attachmentId = (await api<{ id: string }>('/attachments', { method: 'POST', form })).id;
      }
      return post<{ status: string }>(`/store/orders/${order.id}/receipt`, {
        unitsReceived: Number(received),
        damagedUnits: mode === 'problem' ? Number(damaged || 0) : 0,
        problem: mode === 'problem',
        note: note || undefined,
        attachmentId,
      });
    },
    meta: { topLoader: true },
    onSuccess: (r) => {
      if (r.status === 'disputed') notify.warning('Problem reported', 'The dispatcher has been told.');
      else notify.success('Receipt confirmed', `${order.ref} is closed.`);
      void qc.invalidateQueries({ queryKey: ['store-orders'] });
      onDone?.();
    },
    onError: (e) => notify.fail(e, 'Could not save the receipt'),
  });

  const go = () => {
    const r = Number(received);
    if (!Number.isInteger(r) || r < 0 || r > order.units) return setError(`Enter 0 to ${order.units} units.`);
    if (mode === 'problem' && !note.trim()) return setError('Say what is wrong so the dispatcher can act.');
    if (mode === 'confirm' && r < delivered) {
      setMode('problem');
      return setError('Fewer units than delivered: tell us what is wrong.');
    }
    setError(null);
    submit.mutate();
  };

  return (
    <Card className="flex max-w-xl flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-2">
        <h2 className="m-0 text-[18px] font-semibold text-brand-ink">{mode === 'problem' ? `${order.ref}: Report a Problem` : order.ref}</h2>
        <OrderPill status={order.status} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {order.temp === 'chilled' ? <ChilledChip /> : <span className="text-[14px] text-muted">Ambient</span>}
        {order.outlet.parkingConstraint === 'van_only' && <VanChip />}
      </div>
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-2 text-[15px]">
        {order.deliveredAt && (
          <>
            <dt className="text-muted">Delivered at</dt>
            <dd className="m-0">{hhmm(order.deliveredAt)}</dd>
          </>
        )}
        <dt className="text-muted">Window</dt>
        <dd className="m-0">
          {order.outlet.windowOpen} to {order.outlet.windowClose}
        </dd>
        <dt className="text-muted">Units ordered</dt>
        <dd className="m-0">{fmtInt(order.units)}</dd>
        {order.deliveredUnits !== null && order.deliveredUnits !== order.units && (
          <>
            <dt className="text-muted">Units delivered</dt>
            <dd className="m-0">{fmtInt(order.deliveredUnits)}</dd>
          </>
        )}
      </dl>
      <Field label="Units received" htmlFor="rc-received">
        <Input id="rc-received" inputMode="numeric" value={received} onChange={(e) => setReceived(e.target.value.replace(/\D/g, '').slice(0, 4))} big />
      </Field>
      {mode === 'problem' && (
        <>
          <Field label="Damaged units" htmlFor="rc-damaged">
            <Input id="rc-damaged" inputMode="numeric" value={damaged} onChange={(e) => setDamaged(e.target.value.replace(/\D/g, '').slice(0, 4))} big />
          </Field>
          <Field label="What is wrong" htmlFor="rc-note">
            <Input id="rc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Crushed cases" maxLength={280} big />
          </Field>
          <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-control border border-dashed border-field px-4 text-[15px]">
            <Camera className="size-5 text-muted" aria-hidden />
            {photo ? '1 photo attached' : 'Add photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setPhoto(await compressPhoto(f));
              }}
            />
          </label>
        </>
      )}
      {error && (
        <p role="alert" className="m-0 text-[14px] text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="lg" onClick={go} loading={submit.isPending}>
          {mode === 'problem' ? 'Report problem' : 'Confirm receipt'}
        </Button>
        {mode === 'confirm' ? (
          <Button size="lg" variant="secondary" onClick={() => setMode('problem')}>
            Report a problem
          </Button>
        ) : (
          <Button size="lg" variant="ghost" onClick={() => setMode('confirm')}>
            Back
          </Button>
        )}
      </div>
      {mode === 'problem' && <p className="m-0 text-[14px] text-muted">Result: Issue reported. The dispatcher sees it straight away.</p>}
    </Card>
  );
}
