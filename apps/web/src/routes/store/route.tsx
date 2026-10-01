import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { Check, ShoppingBag, Truck } from 'lucide-react';
import { AppShell } from '@/components/shell/app-shell';
import { requireRole } from '@/lib/guard';
import { useRoleRuntime } from '@/lib/use-live';

export const Route = createFileRoute('/store')({
  beforeLoad: ({ context, location }) => requireRole(context.queryClient, 'store_manager', location.href),
  component: StoreLayout,
});

const NAV = [
  { to: '/store', label: 'Place order', icon: <ShoppingBag />, exact: true },
  { to: '/store/deliveries', label: 'My deliveries', icon: <Truck /> },
  { to: '/store/receipt', label: 'Confirm receipt', icon: <Check /> },
];

function StoreLayout() {
  const { me } = Route.useRouteContext();
  const navigate = useNavigate();
  useRoleRuntime(me);
  return (
    <AppShell me={me} nav={NAV} searchPlaceholder="Search your orders" onSearch={(q) => void navigate({ to: '/store/deliveries', search: { q } })}>
      <Outlet />
    </AppShell>
  );
}
