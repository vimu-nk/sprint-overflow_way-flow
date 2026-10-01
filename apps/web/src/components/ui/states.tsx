import { AlertCircle, Inbox, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { Button } from './button';

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line bg-white px-6 py-10 text-center">
      <span className="text-muted">{icon ?? <Inbox className="size-8" aria-hidden />}</span>
      <p className="m-0 text-[17px] font-semibold text-brand-ink">{title}</p>
      {body && <p className="m-0 max-w-md text-[14px] text-muted">{body}</p>}
      {action}
    </div>
  );
}

/** Inline error card with retry (never a blank screen). */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const offline = error instanceof ApiError && error.offline;
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-card border border-line bg-white px-6 py-10 text-center">
      {offline ? <WifiOff className="size-8 text-warn" aria-hidden /> : <AlertCircle className="size-8 text-danger" aria-hidden />}
      <p className="m-0 text-[17px] font-semibold text-brand-ink">{offline ? 'You are offline' : 'This did not load'}</p>
      <p className="m-0 max-w-md text-[14px] text-muted">{error instanceof ApiError ? error.message : 'Something went wrong. Try again.'}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
