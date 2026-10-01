import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { ROLE_HOME, type Role } from '@wayflow/shared';
import { meQuery } from './session';

/** Route guard: UX only. Every API call is re-authorised on the server (SEC-33). */
export async function requireRole(qc: QueryClient, role: Role, href: string) {
  const me = await qc.ensureQueryData(meQuery).catch(() => null);
  if (!me) throw redirect({ to: '/', search: { next: href } });
  if (me.role !== role) throw redirect({ to: ROLE_HOME[me.role] });
  return { me };
}
