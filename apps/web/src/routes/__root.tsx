import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { TopLoader } from '@/components/shell/top-loader';
import { Button } from '@/components/ui/button';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
  notFoundComponent: NotFound,
  errorComponent: RootError,
});

function Root() {
  return (
    <>
      <TopLoader />
      <Outlet />
      {/* One toaster for the whole app; at most 3 visible, announced politely (specs/05 §5). */}
      <Toaster position="top-center" richColors closeButton visibleToasts={3} toastOptions={{ className: 'font-sans' }} />
    </>
  );
}

function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <p className="m-0 text-[13px] font-semibold tracking-wide text-muted uppercase">404</p>
        <h1 className="m-0 text-[26px] font-bold text-brand-ink">This page does not exist</h1>
        <p className="m-0 text-muted">The link may be old, or the item belongs to another team.</p>
        <Link to="/">
          <Button>Go to my home</Button>
        </Link>
      </div>
    </main>
  );
}

function RootError({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center" role="alert">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <h1 className="m-0 text-[26px] font-bold text-brand-ink">Something went wrong</h1>
        <p className="m-0 text-muted">{error instanceof Error && import.meta.env.DEV ? error.message : 'Reload the page to try again.'}</p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
