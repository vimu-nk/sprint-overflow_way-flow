import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Depot, Role } from '@wayflow/shared';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';
export const SKIP_CSRF = 'skipCsrf';

/** Opt a route out of the global deny-by-default auth guard (SEC-25). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
/** Only for endpoints with their own CSRF defence (login uses the Origin check). */
export const SkipCsrfToken = () => SetMetadata(SKIP_CSRF, true);

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  depot: Depot | null;
  outletId: string | null;
  vehicleId: string | null;
  /** Refresh-token family = session id. */
  sid: string;
  issuedAt: number;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser => {
  const req = ctx.switchToHttp().getRequest<{ user: SessionUser }>();
  return req.user;
});
