import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FleetVehicleDto, MoveResultDto, OrderDto, ReasonCode } from '@wayflow/shared';
import { REASON_CODE_LABEL } from '@wayflow/shared';
import { useEffect, useState } from 'react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ChilledChip, MallChip, VanChip } from '@/components/ui/chip';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Gauge } from '@/components/ui/gauge';
import { OrderPill } from '@/components/ui/pill';
import { ApiError, get, post } from '@/lib/api';
import { fmt1, fmtInt, load } from '@/lib/format';
import { notify } from '@/lib/notify';

const DEFER_CODES: ReasonCode[] = ['DISPATCHER_OVERRIDE', 'NO_REEFER_CAPACITY', 'NO_VAN_CAPACITY', 'CAPACITY', 'TIME_BUDGET', 'TRIP_LIMIT', 'FUEL_QUOTA', 'WINDOW_INFEASIBLE', 'VEHICLE_UNAVAILABLE', 'PRIORITY_TRADEOFF'];

/**
 * Manual override (D-04): pick a vehicle and trip, the server validates live against every rule.
 * A blocked move shows the exact rule and leaves the plan unchanged (Figma D2 "Move blocked").
 */
export function MoveDialog({ order, runDate, onClose }: { order: OrderDto | null; runDate: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [vehicleId, setVehicleId] = useState('');
  const [tripNo, setTripNo] = useState(1);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<MoveResultDto | null>(null);
  const [mode, setMode] = useState<'move' | 'defer'>('move');
  const [deferCode, setDeferCode] = useState<ReasonCode>('DISPATCHER_OVERRIDE');
  const [ack, setAck] = useState(false);
  const fleet = useQuery({ queryKey: ['fleet', runDate], queryFn: () => get<FleetVehicleDto[]>(`/dispatcher/fleet?date=${runDate}`), enabled: !!order });
  useEffect(() => {
    setResult(null);
    setReason('');
    setMode('move');
    setAck(false);
    setVehicleId('');
  }, [order?.id]);

  const invalidate = () => ['plans', 'orders', 'deferrals', 'fleet', 'live'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  const check = useMutation({
    mutationFn: (dryRun: boolean) => post<MoveResultDto>('/dispatcher/moves', { orderId: order!.id, vehicleId, tripNo, reason: reason || 'Checking the move', dryRun }),
    onSuccess: (r, dryRun) => {
      setResult(r);
      if (r.ok && !dryRun) {
        notify.success(`${order!.ref} moved to ${r.preview.tripKey}`, 'Rules checked. The audit log has your reason.');
        invalidate();
        onClose();
      }
    },
    onError: (e) => notify.fail(e, 'Could not check this move'),
  });
  const defer = useMutation({
    mutationFn: () => post('/dispatcher/defer', { orderId: order!.id, reasonCode: deferCode, reason, acknowledgeSecondDeferral: ack }),
    meta: { topLoader: true },
    onSuccess: () => {
      notify.success(`${order!.ref} deferred`, 'The store sees your reason when the plan is published.');
      invalidate();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'second_deferral_ack_required') setAck(false);
      notify.fail(e, 'Could not defer this order');
    },
  });

  if (!order) return null;
  const vehicles = (fleet.data ?? []).filter((v) => v.depot === order.outlet.depot);
  const chosen = vehicles.find((v) => v.vehicleId === vehicleId);
  return (
    <Dialog open={!!order} onClose={onClose} title={mode === 'move' ? (order.tripKey ? `Move ${order.ref}` : `Place ${order.ref}`) : `Defer ${order.ref}`} wide>
      <div className="flex flex-col gap-4">
        <div className="rounded-card border border-line p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="m-0 font-semibold text-brand-ink">
              {order.ref}, {order.outlet.name} {order.outlet.outletId}
            </p>
            <OrderPill status={order.status} />
          </div>
          <p className="m-0 text-[14px] text-muted">
            {load(order.weightKg, order.volumeM3)}. Window {order.outlet.windowOpen} to {order.outlet.windowClose}. {order.tripKey ? `Now on ${order.tripKey}.` : 'Not planned.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {order.temp === 'chilled' && <ChilledChip />}
            {order.outlet.parkingConstraint === 'van_only' && <VanChip />}
            {order.outlet.mallWindow && <MallChip window={order.outlet.mallWindow} />}
          </div>
        </div>
        <div className="flex gap-2" role="tablist">
          <Button size="sm" variant={mode === 'move' ? 'primary' : 'secondary'} onClick={() => setMode('move')} role="tab" aria-selected={mode === 'move'}>
            {order.tripKey ? 'Move to another trip' : 'Place on a trip'}
          </Button>
          {order.status !== 'deferred' && (
            <Button size="sm" variant={mode === 'defer' ? 'primary' : 'secondary'} onClick={() => setMode('defer')} role="tab" aria-selected={mode === 'defer'}>
              Defer order
            </Button>
          )}
        </div>
        {mode === 'move' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <Field label="Vehicle" htmlFor="mv-vehicle" hint={chosen ? `${chosen.type}, ${chosen.temp}, ${fmtInt(chosen.weightCapKg)} kg / ${fmt1(chosen.volumeCapM3)} m³${chosen.status === 'in_workshop' ? ', in workshop' : ''}` : undefined}>
                <Select id="mv-vehicle" value={vehicleId} onChange={(e) => (setVehicleId(e.target.value), setResult(null))}>
                  <option value="">Choose a vehicle</option>
                  {vehicles.map((v) => (
                    <option key={v.vehicleId} value={v.vehicleId}>
                      {v.vehicleId} · {v.type === 'van' ? 'van' : 'truck'}, {v.temp}
                      {v.trips.length ? ` · ${v.trips.join(', ')}` : ''}
                      {v.status === 'in_workshop' ? ' · workshop' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Trip" htmlFor="mv-trip">
                <Select id="mv-trip" value={tripNo} onChange={(e) => (setTripNo(Number(e.target.value)), setResult(null))}>
                  <option value={1}>Trip 1</option>
                  <option value={2}>Trip 2</option>
                </Select>
              </Field>
            </div>
            <Field label="Reason for the change" htmlFor="mv-reason" hint="Recorded in the audit log.">
              <Input id="mv-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Keep the skipped outlet on today's run" />
            </Field>
            {result && !result.ok && (
              <Banner tone="danger" title={result.title ?? 'Move blocked'}>
                {result.message} The plan has not changed.
              </Banner>
            )}
            {result?.ok && (
              <div className="flex flex-col gap-2 rounded-card border border-line p-3">
                <p className="m-0 font-semibold text-ok">It fits {result.preview.tripKey}. Every rule passes.</p>
                <Gauge label="Weight" value={`${fmtInt(result.preview.weightKg)} / ${fmtInt(result.preview.weightCapKg)} kg`} ratio={result.preview.weightKg / result.preview.weightCapKg} />
                <Gauge label="Volume" value={`${fmt1(result.preview.volumeM3)} / ${fmt1(result.preview.volumeCapM3)} m³`} ratio={result.preview.volumeM3 / result.preview.volumeCapM3} />
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {result && !result.ok && order.status !== 'deferred' && (
                <Button variant="secondary" onClick={() => setMode('defer')}>
                  Defer order
                </Button>
              )}
              <Button variant="secondary" onClick={onClose}>
                Cancel move
              </Button>
              {result?.ok ? (
                <Button onClick={() => check.mutate(false)} loading={check.isPending} disabled={reason.trim().length < 3}>
                  Confirm move
                </Button>
              ) : (
                <Button onClick={() => check.mutate(true)} loading={check.isPending} disabled={!vehicleId}>
                  Check move
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <Field label="Reason code" htmlFor="df-code">
              <Select id="df-code" value={deferCode} onChange={(e) => setDeferCode(e.target.value as ReasonCode)}>
                {DEFER_CODES.map((c) => (
                  <option key={c} value={c}>
                    {REASON_CODE_LABEL[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason the store sees" htmlFor="df-reason" hint="Every deferral needs a reason. The store sees it.">
              <Textarea id="df-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={280} />
            </Field>
            {order.deferredYesterday && (
              <label className="flex min-h-11 items-start gap-3 rounded-control bg-warn-tint p-3 text-[14px] text-warn">
                <input type="checkbox" className="mt-1 size-4 accent-[#174d3a]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                {order.outlet.outletId} was deferred on the last run. I confirm it is deferred again.
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => defer.mutate()} loading={defer.isPending} disabled={reason.trim().length < 3 || (order.deferredYesterday && !ack)}>
                Defer order
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
