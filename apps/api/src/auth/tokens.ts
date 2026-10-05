import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Role } from '@wayflow/shared';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../env.js';

const secure = env.COOKIE_SECURE;

/** Cookie names: `__Host-`/`__Secure-` prefixes whenever cookies are Secure (SEC-13). */
export const COOKIE = {
  access: secure ? '__Host-wp_at' : 'wp_at',
  refresh: secure ? '__Secure-wp_rt' : 'wp_rt',
  csrf: secure ? '__Host-wp_csrf' : 'wp_csrf',
} as const;

export const REFRESH_PATH = '/api/v1/auth';
export const ACCESS_TTL_SEC = 15 * 60;
const ISSUER = 'wayflow-api';
const AUDIENCE = 'wayflow-web';
const key = new TextEncoder().encode(env.JWT_SECRET);

/** Session lifetimes by role (specs/19 §2). */
export const LIFETIMES: Record<Role, { idleSec: number; absoluteSec: number }> = {
  dispatcher: { idleSec: 30 * 60, absoluteSec: 12 * 3600 },
  store_manager: { idleSec: 60 * 60, absoluteSec: 12 * 3600 },
  loader: { idleSec: 30 * 60, absoluteSec: 12 * 3600 },
  // Drivers must survive long offline stretches (SEC-74).
  driver: { idleSec: 12 * 3600, absoluteSec: 7 * 24 * 3600 },
};

export interface AccessClaims {
  sub: string;
  role: Role;
  sid: string;
  iat: number;
}

export async function signAccess(userId: string, role: Role, sid: string): Promise<string> {
  return new SignJWT({ role, sid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(key);
}

/** Verifies with a pinned algorithm (rejects `none` and alg confusion, SEC-10) and 30 s leeway (SEC-24). */
export async function verifyAccess(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      clockTolerance: 30,
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.role !== 'string') return null;
    return { sub: payload.sub, role: payload.role as Role, sid: payload.sid, iat: payload.iat ?? 0 };
  } catch {
    return null;
  }
}

/** Opaque 256-bit refresh token (SEC-11). Only its keyed hash is stored. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHmac('sha256', env.REFRESH_TOKEN_PEPPER).update(token).digest('hex');
}

/** CSRF token bound to the session id (double-submit, SEC-17). */
export function csrfTokenFor(sid: string): string {
  return createHmac('sha256', env.CSRF_SECRET).update(`csrf:${sid}`).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export const cookieBase = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
