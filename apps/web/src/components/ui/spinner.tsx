import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Inline spinner for data loading inside a region (used together with skeletons). */
export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-muted', className)}>
      <Loader2 className="size-4 animate-spin text-brand" aria-hidden />
      {label}
    </span>
  );
}
