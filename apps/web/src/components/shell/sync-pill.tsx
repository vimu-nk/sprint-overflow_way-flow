import { Link } from '@tanstack/react-router';
import { CloudOff, Loader2, RefreshCw, Check } from 'lucide-react';
import { useSyncState } from '@/lib/offline/sync';
import { cn } from '@/lib/cn';

/** Header sync status (specs/05 §10): Online · synced / Syncing 3… / Offline · 4 pending / needs attention. */
export function SyncPill({ to }: { to: string }) {
  const s = useSyncState();
  const label = !s.online
    ? `Offline · ${s.pending} pending`
    : s.syncing
      ? `Syncing ${s.pending}…`
      : s.attention
        ? `${s.attention} need attention`
        : s.pending
          ? `${s.pending} to send`
          : 'Online · synced';
  return (
    <Link
      to={to}
      aria-live="polite"
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium no-underline',
        !s.online || s.attention ? 'bg-warn-tint text-warn' : s.pending ? 'bg-info-tint text-info' : 'bg-brand-tint text-ok',
      )}
    >
      {!s.online ? <CloudOff className="size-4" aria-hidden /> : s.syncing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : s.attention || s.pending ? <RefreshCw className="size-4" aria-hidden /> : <Check className="size-4" aria-hidden />}
      <span className="max-[380px]:sr-only">{label}</span>
    </Link>
  );
}
