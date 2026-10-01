import { cn } from '@/lib/cn';

/**
 * Capacity gauge (Figma plan board): green under 90 %, amber from 90 %, red when over.
 * The value text carries the numbers so colour is not the only signal.
 */
export function Gauge({ label, value, ratio, note, compact }: { label: string; value: string; ratio: number; note?: string; compact?: boolean }) {
  const over = ratio > 1.0001;
  const warn = !over && ratio >= 0.9;
  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn('flex justify-between gap-3 leading-5', compact ? 'text-[13px]' : 'text-[13px]')}>
        <span className="font-medium text-muted">{label}</span>
        <span className={cn(over ? 'font-semibold text-danger' : warn ? 'text-ink' : 'text-ink')}>{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-[3px] bg-chip" role="meter" aria-label={label} aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-2', over ? 'bg-danger' : warn ? 'bg-warn-bright' : 'bg-brand')} style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
      </div>
      {note && <span className={cn('text-[13px]', over ? 'text-danger' : 'text-muted')}>{note}</span>}
    </div>
  );
}
