import { Link } from '@tanstack/react-router';
import type { MeDto } from '@wayflow/shared';
import { Menu, Search, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/cn';
import { Logo } from './logo';
import { NotificationBell } from './notification-bell';
import { UserMenu } from './user-menu';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  exact?: boolean;
}

/**
 * Desktop shell for the dispatcher and store manager (Figma D1–D6, SM1–SM3): top bar with search,
 * bell and user; left navigation. Below 1024 px the navigation becomes a drawer.
 */
export function AppShell({ me, nav, children, searchPlaceholder, onSearch, footer }: { me: MeDto; nav: NavItem[]; children: ReactNode; searchPlaceholder: string; onSearch?: (q: string) => void; footer?: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [q, setQ] = useState('');
  const navList = (
    <nav aria-label="Main" className="flex flex-col gap-1 p-4">
      {nav.map((n) => (
        <Link
          key={n.to}
          to={n.to}
          activeOptions={{ exact: n.exact ?? false }}
          onClick={() => setDrawer(false)}
          className="flex min-h-11 items-center gap-3 rounded-control px-3 text-[15px] font-medium text-ink no-underline hover:bg-chip data-[status=active]:bg-brand-tint data-[status=active]:font-semibold data-[status=active]:text-brand"
        >
          <span className="size-5 shrink-0 [&_svg]:size-5" aria-hidden>
            {n.icon}
          </span>
          {n.label}
        </Link>
      ))}
    </nav>
  );
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:rounded focus:bg-white focus:p-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-line bg-white px-4 lg:px-6">
        <button type="button" className="grid size-11 place-items-center rounded-control hover:bg-chip lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
          <Menu className="size-5" aria-hidden />
        </button>
        <Link to={nav[0]!.to} className="no-underline" aria-label="Waypoint home">
          <Logo />
        </Link>
        <form
          role="search"
          className="mx-auto hidden w-full max-w-[400px] md:block"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim().length >= 2) onSearch?.(q.trim());
          }}
        >
          <label className="relative block">
            <span className="sr-only">{searchPlaceholder}</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="h-10 w-full rounded-control border border-line bg-white pr-3 pl-9 text-[15px]" type="search" />
          </label>
        </form>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <NotificationBell />
          <UserMenu me={me} />
        </div>
      </header>
      <div className="flex">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 flex-col justify-between border-r border-line bg-white lg:flex">
          {navList}
          {footer && <div className="p-4">{footer}</div>}
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setDrawer(false)} />
            <div className="relative flex h-full w-72 max-w-[85vw] flex-col justify-between bg-white">
              <div>
                <div className="flex h-16 items-center justify-between border-b border-line px-4">
                  <Logo />
                  <button type="button" className="grid size-11 place-items-center rounded-control hover:bg-chip" onClick={() => setDrawer(false)} aria-label="Close menu">
                    <X className="size-5" aria-hidden />
                  </button>
                </div>
                {navList}
              </div>
              {footer && <div className="p-4">{footer}</div>}
            </div>
          </div>
        )}
        <main id="main" className={cn('min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8')}>
          {children}
        </main>
      </div>
    </div>
  );
}

/** Page heading row: title, subtitle and one primary action (Figma page header). */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="m-0 text-[26px] leading-[34px] font-bold tracking-[-0.01em] text-brand-ink sm:text-[32px] sm:leading-[40px]">{title}</h1>
        {subtitle && <div className="m-0 mt-1 text-[15px] leading-[22px] text-muted">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}
