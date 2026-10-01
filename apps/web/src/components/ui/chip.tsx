import { AlertTriangle, Clock, Snowflake, Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Small bordered tag used for rules: Chilled, Van only, Mall window, Skipped last run. */
export function Chip({ icon, tone = 'neutral', children, className }: { icon?: ReactNode; tone?: 'neutral' | 'info' | 'warning'; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-pill border px-2 text-[12px] font-medium whitespace-nowrap',
        tone === 'info' && 'border-line bg-white text-info',
        tone === 'neutral' && 'border-line bg-white text-ink',
        tone === 'warning' && 'border-transparent bg-warn-tint text-warn',
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export const ChilledChip = ({ label = 'Chilled' }: { label?: string }) => (
  <Chip tone="info" icon={<Snowflake className="size-3.5" aria-hidden />}>
    {label}
  </Chip>
);
export const VanChip = ({ label = 'Van only' }: { label?: string }) => (
  <Chip icon={<Truck className="size-3.5" aria-hidden />}>{label}</Chip>
);
export const MallChip = ({ window }: { window?: string | null }) => (
  <Chip icon={<Clock className="size-3.5" aria-hidden />}>{window ? `Mall window ${window}` : 'Mall window'}</Chip>
);
export const SkippedChip = () => (
  <Chip tone="warning" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
    Skipped last run
  </Chip>
);
