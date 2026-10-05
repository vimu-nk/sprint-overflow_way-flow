import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  type OrderStatus,
  STOP_STATUS_LABEL,
  STOP_STATUS_TONE,
  type StopStatus,
  type Tone,
  TRIP_STATUS_LABEL,
  TRIP_STATUS_TONE,
  type TripStatus,
} from '@wayflow/shared';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const toneText: Record<Tone, string> = {
  success: 'text-ok',
  info: 'text-info',
  warning: 'text-warn',
  danger: 'text-danger',
  neutral: 'text-muted',
};

/** Status badge: grey pill, coloured label (Figma status style). Colour is never the only signal. */
export function Pill({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-[26px] items-center rounded-pill bg-chip px-2.5 text-[13px] leading-none font-medium whitespace-nowrap', toneText[tone], className)}>
      {children}
    </span>
  );
}

export const OrderPill = ({ status }: { status: OrderStatus }) => <Pill tone={ORDER_STATUS_TONE[status]}>{ORDER_STATUS_LABEL[status]}</Pill>;
export const TripPill = ({ status, issue }: { status: TripStatus; issue?: string | null }) =>
  issue ? <Pill tone="danger">{issue}</Pill> : <Pill tone={TRIP_STATUS_TONE[status]}>{TRIP_STATUS_LABEL[status]}</Pill>;
export const StopPill = ({ status }: { status: StopStatus }) => <Pill tone={STOP_STATUS_TONE[status]}>{STOP_STATUS_LABEL[status]}</Pill>;
