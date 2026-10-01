import type { TripDto } from '@wayflow/shared';
import { Truck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ChilledChip, Chip } from '@/components/ui/chip';
import { Gauge } from '@/components/ui/gauge';
import { TripPill } from '@/components/ui/pill';
import { cn } from '@/lib/cn';
import { fmt1, fmtInt } from '@/lib/format';

export function vehicleLabel(t: Pick<TripDto, 'vehicleType' | 'vehicleTemp'>) {
  return t.vehicleTemp === 'reefer' ? (t.vehicleType === 'van' ? 'refrigerated van' : 'reefer truck') : t.vehicleType === 'van' ? 'van' : 'truck';
}

/** Trip card from the Figma plan board (D2): status, route, rule chips, kg/m³/time gauges, fuel line. */
export function TripCard({ t, onOpen, highlight, override }: { t: TripDto; onOpen?: () => void; highlight?: boolean; override?: { weight: number; volume: number; note?: string } }) {
  const weight = override?.weight ?? t.weight.used;
  const volume = override?.volume ?? t.volume.used;
  const issue = t.hasIssue ? 'Issue reported' : t.hasShortfall && t.status !== 'completed' ? 'Short-loaded' : null;
  return (
    <Card className={cn('flex flex-col gap-3 p-4 text-left', highlight && 'border-danger ring-1 ring-danger', onOpen && 'cursor-pointer hover:border-field')} onClick={onOpen} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} onKeyDown={(e) => onOpen && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[17px] leading-6 font-semibold text-brand-ink">{t.key}</span>
        <TripPill status={t.status} issue={issue} />
      </div>
      <p className="m-0 -mt-1 text-[13px] text-muted">
        {t.brand}, {t.district}. {t.depart} to {t.back}, {t.stopCount} stop{t.stopCount === 1 ? '' : 's'}
      </p>
      {(t.vehicleTemp === 'reefer' || t.vehicleType === 'van') && (
        <div className="flex flex-wrap gap-1.5">
          {t.vehicleTemp === 'reefer' && <ChilledChip label={`Chilled, ${vehicleLabel(t)}`} />}
          {t.vehicleType === 'van' && <Chip icon={<Truck className="size-3.5" aria-hidden />}>Van</Chip>}
        </div>
      )}
      <Gauge label="Weight" value={`${fmtInt(weight)} / ${fmtInt(t.weight.cap)} kg`} ratio={weight / t.weight.cap} />
      <Gauge
        label="Volume"
        value={`${fmt1(volume)} / ${fmt1(t.volume.cap)} m³`}
        ratio={volume / t.volume.cap}
        note={volume > t.volume.cap ? `Over by ${fmt1(volume - t.volume.cap)} m³. This move is blocked.` : override?.note}
      />
      <Gauge label={t.budget.bothTrips ? 'Trip time, both trips' : 'Trip time'} value={`${fmtInt(t.budget.used)} / ${t.budget.cap} min`} ratio={t.budget.used / t.budget.cap} />
      <p className="m-0 text-[13px] text-muted">
        Trip {t.tripNo} of max 2. Fuel {fmt1(t.fuelL)} L, weekly quota {fmtInt(t.weeklyQuotaL)} L.
      </p>
    </Card>
  );
}
