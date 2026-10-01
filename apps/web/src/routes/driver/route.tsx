import { createFileRoute, Outlet } from '@tanstack/react-router';
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
  return <Outlet />;
}
