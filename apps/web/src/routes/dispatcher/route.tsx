import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { AlertTriangle, BarChart3, Clock, Layers, MapPin, ShoppingBag, Truck } from 'lucide-react';
import { AppShell } from '@/components/shell/app-shell';
import { SimClock } from '@/features/dispatcher/sim-clock';
import { requireRole } from '@/lib/guard';
import { useRoleRuntime } from '@/lib/use-live';

export const Route = createFileRoute('/dispatcher')({
  beforeLoad: ({ context, location }) => requireRole(context.queryClient, 'dispatcher', location.href),
  component: DispatcherLayout,
});

const NAV = [
  { to: '/dispatcher', label: 'Live tracking', icon: <MapPin />, exact: true },
  { to: '/dispatcher/queue', label: 'Order queue', icon: <ShoppingBag /> },
  { to: '/dispatcher/plan', label: 'Plan board', icon: <Layers /> },
  { to: '/dispatcher/deferrals', label: 'Deferrals', icon: <Clock /> },
  { to: '/dispatcher/exceptions', label: 'Exceptions', icon: <AlertTriangle /> },
  { to: '/dispatcher/fleet', label: 'Fleet', icon: <Truck /> },
  { to: '/dispatcher/outlook', label: 'Outlook', icon: <BarChart3 /> },
];

function DispatcherLayout() {
  const { me } = Route.useRouteContext();
  const navigate = useNavigate();
  useRoleRuntime(me);
  return (
    <AppShell me={me} nav={NAV} searchPlaceholder="Search orders, trips or outlets" onSearch={(q) => void navigate({ to: '/dispatcher/queue', search: { q } })} footer={<SimClock />}>
      <Outlet />
    </AppShell>
  );
}
