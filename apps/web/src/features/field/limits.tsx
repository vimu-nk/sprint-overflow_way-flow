import type { TripDto } from '@wayflow/shared';
import { Card } from '@/components/ui/card';
import { Gauge } from '@/components/ui/gauge';
import { fmt1, fmtInt } from '@/lib/format';

const pct = (a: number, b: number) => `${Math.round((100 * a) / b)}%`;

/** Weight, volume and trip-time limits (DR1 / L2 "Trip Limits"). */
export function TripLimits({ t, title }: { t: TripDto; title?: string }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      {title && <h2 className="m-0 text-[17px] font-semibold text-brand-ink">{title}</h2>}
      <Gauge label="Weight" value={`${fmtInt(t.weight.used)} of ${fmtInt(t.weight.cap)} kg · ${pct(t.weight.used, t.weight.cap)}`} ratio={t.weight.used / t.weight.cap} />
      <Gauge label="Volume" value={`${fmt1(t.volume.used)} of ${fmt1(t.volume.cap)} m³ · ${pct(t.volume.used, t.volume.cap)}`} ratio={t.volume.used / t.volume.cap} />
      <Gauge label={`Trip time${t.budget.bothTrips ? ', both trips' : ''}, ${t.budget.kind === 'fresh' ? 'Fresh' : 'Style + Tech'}`} value={`${fmtInt(t.budget.used)} of ${t.budget.cap} min · ${pct(t.budget.used, t.budget.cap)}`} ratio={t.budget.used / t.budget.cap} />
    </Card>
  );
}
