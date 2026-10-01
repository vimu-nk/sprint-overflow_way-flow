import { createFileRoute, Outlet, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { requireRole } from '@/lib/guard';
import { useRoleRuntime } from '@/lib/use-live';

export const Route = createFileRoute('/driver')({
  beforeLoad: ({ context, location }) => requireRole(context.queryClient, 'driver', location.href),
  component: DriverLayout,
});

// Non-critical toasts wait while a stop form is open (specs/09 §5 "quiet" states).
const quiet = () => /\/driver\/record\//.test(window.location.pathname);

function DriverLayout() {
  const { me } = Route.useRouteContext();
  useRoleRuntime(me, { field: true, quiet });
  const router = useRouter();
  // Fetch every driver screen's code while online so the whole flow works offline (R-04).
  useEffect(() => {
    void Promise.all([
      router.loadRouteChunk(router.routesByPath['/driver/record/$stopId']),
      router.loadRouteChunk(router.routesByPath['/driver/stops/$stopId']),
      router.loadRouteChunk(router.routesByPath['/driver/sync']),
      router.loadRouteChunk(router.routesByPath['/driver/report']),
    ]).catch(() => undefined);
  }, [router]);
  return <Outlet />;
}
