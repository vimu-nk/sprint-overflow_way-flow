import { createFileRoute, Outlet } from '@tanstack/react-router';
import { requireRole } from '@/lib/guard';
import { useRoleRuntime } from '@/lib/use-live';

export const Route = createFileRoute('/loader')({
  beforeLoad: ({ context, location }) => requireRole(context.queryClient, 'loader', location.href),
  component: LoaderLayout,
});

function LoaderLayout() {
  const { me } = Route.useRouteContext();
  useRoleRuntime(me, { field: true });
  return <Outlet />;
}
