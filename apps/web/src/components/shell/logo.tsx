import { Truck } from 'lucide-react';

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {!compact && (
        <span className="grid size-[30px] place-items-center rounded-[7px] bg-brand text-white" aria-hidden>
          <Truck className="size-[18px]" />
        </span>
      )}
      <span className="text-[20px] font-bold tracking-[-0.01em] text-brand-ink">Waypoint</span>
    </span>
  );
}
