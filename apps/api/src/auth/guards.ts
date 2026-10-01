import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@wayflow/shared';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC, ROLES_KEY, type SessionUser, SKIP_CSRF } from '../common/decorators.js';
import { AppError } from '../common/errors.js';
import { env } from '../env.js';
import { AuthService } from './auth.service.js';
import { COOKIE, csrfTokenFor, safeEqual, verifyAccess } from './tokens.js';

type Req = FastifyRequest & { user?: SessionUser };

const unauthenticated = () => new AppError('unauthenticated', 'Sign in to continue.', HttpStatus.UNAUTHORIZED);

/** Global deny-by-default authentication (SEC-25). Scope is re-read from the DB per request (SEC-10). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<Req>();
    const token = req.cookies?.[COOKIE.access];
    if (!token) throw unauthenticated();
    const claims = await verifyAccess(token);
    if (!claims) throw new AppError('token_expired', 'Session expired.', HttpStatus.UNAUTHORIZED);
    const [user, active] = await Promise.all([
      this.auth.loadSessionUser(claims.sub, claims.sid, claims.iat),
      this.auth.sessionActive(claims.sid, claims.sub),
    ]);
    if (!user || !active) throw unauthenticated();
    req.user = user;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const req = ctx.switchToHttp().getRequest<Req>();
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError('forbidden', 'You do not have access to this.', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}

const allowedOrigins = new Set(env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean));

/** Origin/Referer allow-list check for state-changing requests (SEC-17). */
export function originAllowed(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const sameHost = (u: string) => {
    try {
      const url = new URL(u);
      return allowedOrigins.has(url.origin) || url.host === host;
    } catch {
      return false;
    }
  };
  if (origin) return sameHost(origin);
  if (referer) return sameHost(referer);
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  // Non-browser clients (curl, tests) send neither header and cannot be CSRF victims.
  return true;
}

/** CSRF: Origin allow-list plus a session-bound double-submit token header (SEC-17). */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Req>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    if (!originAllowed(req)) throw new AppError('csrf_failed', 'Request origin not allowed.', HttpStatus.FORBIDDEN);
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()]);
    if (skip || !req.user) return true;
    const header = req.headers['x-csrf-token'];
    if (typeof header !== 'string' || !safeEqual(header, csrfTokenFor(req.user.sid))) {
      throw new AppError('csrf_failed', 'Security token missing or stale. Reload the page.', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}

void COOKIE;
