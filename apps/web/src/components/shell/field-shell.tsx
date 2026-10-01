import type { MeDto } from '@wayflow/shared';
import type { ReactNode } from 'react';
import { Banner } from '@/components/ui/banner';
import { hhmm } from '@/lib/format';
import { useSyncState } from '@/lib/offline/sync';
import { Logo } from './logo';
import { NotificationBell } from './notification-bell';
import { SyncPill } from './sync-pill';
import { UserMenu } from './user-menu';

/**
 * Phone/tablet shell for drivers and loaders (Figma DR1–DR4, L1–L3): offline banner on top,
 * slim header, single column, sticky bottom action bar for the one primary action.
 */
export function FieldShell({ me, place, syncTo, children, bottom, offlineText }: { me: MeDto; place?: string; syncTo: string; children: ReactNode; bottom?: ReactNode; offlineText?: string }) {
  const s = useSyncState();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:rounded focus:bg-white focus:p-2">
        Skip to content
      </a>
      {!s.online && (
        <div className="sticky top-0 z-40">
          <Banner tone="offline" title={`Offline${s.offlineSince ? `. Saved on this device at ${hhmm(s.offlineSince)}` : ''}`} className="rounded-none" live>
            {offlineText ?? (s.pending ? `${s.pending} item${s.pending > 1 ? 's' : ''} will send when signal returns.` : 'Your actions are saved and will send when signal returns.')}
          </Banner>
        </div>
      )}
      <header className="flex h-16 items-center gap-2 border-b border-line bg-white px-4">
        <Logo compact />
        {place && <span className="ml-2 hidden truncate text-[15px] text-muted sm:inline">{place}</span>}
        <div className="ml-auto flex items-center gap-1">
          <SyncPill to={syncTo} />
          <NotificationBell />
          <UserMenu me={me} soft />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pt-5 pb-28">
        {children}
      </main>
      {bottom && <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white px-4 pt-4 safe-bottom">{<div className="mx-auto max-w-3xl">{bottom}</div>}</div>}
    </div>
  );
}
