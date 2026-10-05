import { AlertTriangle, CheckCircle2, Info, WifiOff, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'warning' | 'danger' | 'info' | 'success' | 'offline';
const tones: Record<Tone, { box: string; icon: ReactNode }> = {
  warning: { box: 'bg-warn-tint text-warn', icon: <AlertTriangle className="size-5" aria-hidden /> },
  offline: { box: 'bg-warn-tint text-warn', icon: <WifiOff className="size-5" aria-hidden /> },
  danger: { box: 'bg-danger-tint text-danger', icon: <XCircle className="size-5" aria-hidden /> },
  info: { box: 'bg-info-tint text-info', icon: <Info className="size-5" aria-hidden /> },
  success: { box: 'bg-brand-tint text-ok', icon: <CheckCircle2 className="size-5" aria-hidden /> },
};

/** Inline alert banner (Figma: "Updates delayed", "Plan changed", "Offline", "Move blocked"). */
export function Banner({ tone = 'warning', title, children, action, className, live }: { tone?: Tone; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; live?: boolean }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-card px-4 py-3', tones[tone].box, className)} role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined}>
      <span className="mt-0.5 shrink-0">{tones[tone].icon}</span>
      <div className="min-w-0 flex-1">
        <p className="m-0 font-semibold text-ink">{title}</p>
        {children && <div className="text-[14px] leading-5">{children}</div>}
      </div>
      {action}
    </div>
  );
}
