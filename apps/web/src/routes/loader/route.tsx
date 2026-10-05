import { createFileRoute, Outlet, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { requireRole } from '@/lib/guard';
import { useRoleRuntime } from '@/lib/use-live';

export const Route = createFileRoute('/loader')({
  beforeLoad: ({ context, location }) => requireRole(context.queryClient, 'loader', location.href),
  component: LoaderLayout,
});

function LoaderLayout() {
  const { me } = Route.useRouteContext();
  useRoleRuntime(me, { field: true });
  const router = useRouter();
  // Fetch every loader screen's code while online so the dock keeps working offline (L-07).
  useEffect(() => {
    void Promise.all([
      router.loadRouteChunk(router.routesByPath['/loader/trips/$tripId']),
      router.loadRouteChunk(router.routesByPath['/loader/flag/$tripId/$stopId']),
    ]).catch(() => undefined);
  }, [router]);
  return <Outlet />;
}
