import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Role } from '@wayflow/shared';
import { and, asc, eq, gt, isNull, ne } from 'drizzle-orm';
import { AuditService, type AuditMeta } from '../audit/audit.service.js';
import type { SessionUser } from '../common/decorators.js';
import { AppError } from '../common/errors.js';
import { DB, type Db } from '../db/drizzle.module.js';
import { outlets, refreshTokens, users } from '../db/schema.js';
import { LoginLimiter } from './login-limiter.js';
import { dummyVerify, hashPassword, needsRehash, passwordPolicyError, verifyPassword } from './passwords.js';
import { hashRefreshToken, LIFETIMES, newRefreshToken, signAccess } from './tokens.js';

export const MAX_SESSIONS = 5;
const REUSE_GRACE_MS = 10_000;

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  sid: string;
  user: { id: string; role: Role };
  refreshMaxAgeSec: number;
}

const invalid = () => new AppError('invalid_credentials', 'Invalid email or password', HttpStatus.UNAUTHORIZED);
const sessionExpired = () => new AppError('session_expired', 'Your session has ended. Sign in again.', HttpStatus.UNAUTHORIZED);

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly limiter: LoginLimiter,
  ) {}

  async login(email: string, password: string, meta: AuditMeta & { ip: string }): Promise<IssuedSession> {
    const wait = await this.limiter.retryAfter(meta.ip, email);
    if (wait > 0) {
      throw new AppError('rate_limited', 'Too many sign-in attempts. Wait a moment and try again.', HttpStatus.TOO_MANY_REQUESTS, {
        retryAfter: wait,
      });
    }
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    // Same work and same answer for unknown users and wrong passwords (SEC-06).
    const ok = user && user.isActive ? await verifyPassword(user.passwordHash, password) : await dummyVerify(password);
    if (!user || !ok || !user.isActive) {
      await this.limiter.fail(meta.ip, email);
      const recent = await this.limiter.noteFailureForAlert();
      if (recent === 21) this.log.warn('ALERT: more than 20 failed logins in 5 minutes (SEC-68)');
      await this.audit.record(null, 'auth.login_failed', { type: 'user', id: user?.id }, { reason: user ? 'bad_password' : 'unknown_user' }, meta);
      throw invalid();
    }
    await this.limiter.succeed(meta.ip, email);
    if (needsRehash(user.passwordHash)) {
      await this.db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, user.id));
      await this.audit.record({ id: user.id, role: user.role }, 'auth.password_rehashed', { type: 'user', id: user.id }, {}, meta);
    }
    const session = await this.startSession(user.id, user.role, meta.userAgent ?? null);
    await this.audit.record({ id: user.id, role: user.role }, 'auth.login', { type: 'user', id: user.id }, { sid: session.sid }, meta);
    return session;
  }

  /** New refresh family on every login (no fixation, SEC-16) and a cap of 5 live sessions (SEC-19). */
  private async startSession(userId: string, role: Role, userAgent: string | null): Promise<IssuedSession> {
    const life = LIFETIMES[role];
    const now = Date.now();
    const sid = crypto.randomUUID();
    const refreshToken = newRefreshToken();
    await this.db.transaction(async (tx) => {
      const live = await tx
        .selectDistinct({ familyId: refreshTokens.familyId, createdAt: refreshTokens.createdAt })
        .from(refreshTokens)
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt), isNull(refreshTokens.usedAt), gt(refreshTokens.absoluteExpiresAt, new Date())))
        .orderBy(asc(refreshTokens.createdAt));
      const excess = live.length - (MAX_SESSIONS - 1);
      for (const f of live.slice(0, Math.max(0, excess))) {
        await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.familyId, f.familyId));
      }
      await tx.insert(refreshTokens).values({
        userId,
        familyId: sid,
        tokenHash: hashRefreshToken(refreshToken),
        userAgent: userAgent?.slice(0, 200) ?? null,
        idleExpiresAt: new Date(now + life.idleSec * 1000),
        absoluteExpiresAt: new Date(now + life.absoluteSec * 1000),
      });
    });
    return {
      accessToken: await signAccess(userId, role, sid),
      refreshToken,
      sid,
      user: { id: userId, role },
      refreshMaxAgeSec: life.idleSec,
    };
  }

  /** Rotation with reuse detection (SEC-12). */
  async refresh(token: string, meta: AuditMeta): Promise<IssuedSession> {
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashRefreshToken(token)));
    if (!row || row.revokedAt) throw sessionExpired();
    const [user] = await this.db.select().from(users).where(eq(users.id, row.userId));
    if (!user || !user.isActive) throw sessionExpired();
    const now = new Date();
    if (row.usedAt) {
      if (now.getTime() - row.usedAt.getTime() <= REUSE_GRACE_MS && row.replacedBy) {
        // Another tab refreshed a moment ago; its new cookie is already in the browser.
        throw new AppError('refresh_race', 'Session was just refreshed. Retry the request.', HttpStatus.CONFLICT);
      }
      await this.db.update(refreshTokens).set({ revokedAt: now }).where(eq(refreshTokens.familyId, row.familyId));
      await this.audit.record({ id: user.id, role: user.role }, 'security.refresh_token_reuse', { type: 'session', id: row.familyId }, {}, meta);
      throw sessionExpired();
    }
    if (row.idleExpiresAt < now || row.absoluteExpiresAt < now) throw sessionExpired();
    const life = LIFETIMES[user.role];
    const next = newRefreshToken();
    // Sliding idle timeout never extends past the absolute lifetime (SEC-22).
    const idle = new Date(Math.min(now.getTime() + life.idleSec * 1000, row.absoluteExpiresAt.getTime()));
    await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(refreshTokens)
        .values({
          userId: user.id,
          familyId: row.familyId,
          tokenHash: hashRefreshToken(next),
          userAgent: row.userAgent,
          idleExpiresAt: idle,
          absoluteExpiresAt: row.absoluteExpiresAt,
        })
        .returning({ id: refreshTokens.id });
      await tx.update(refreshTokens).set({ usedAt: now, lastUsedAt: now, replacedBy: created!.id }).where(eq(refreshTokens.id, row.id));
    });
    return {
      accessToken: await signAccess(user.id, user.role, row.familyId),
      refreshToken: next,
      sid: row.familyId,
      user: { id: user.id, role: user.role },
      refreshMaxAgeSec: Math.max(1, Math.round((idle.getTime() - now.getTime()) / 1000)),
    };
  }

  async logout(user: SessionUser, meta: AuditMeta, everywhere = false): Promise<void> {
    const where = everywhere ? eq(refreshTokens.userId, user.id) : eq(refreshTokens.familyId, user.sid);
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(where, isNull(refreshTokens.revokedAt)));
    await this.audit.record(user, everywhere ? 'auth.logout_all' : 'auth.logout', { type: 'session', id: user.sid }, {}, meta);
  }

  async revokeByRefreshToken(token: string): Promise<void> {
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashRefreshToken(token)));
    if (row) await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.familyId, row.familyId));
  }

  /** Is this session still live? Called by the auth guard on every request. */
  async sessionActive(sid: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.familyId, sid), eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
      .limit(1);
    return !!row;
  }

  async loadSessionUser(userId: string, sid: string, iat: number): Promise<SessionUser | null> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u || !u.isActive) return null;
    // Tokens issued before a password/role change are void (SEC-16).
    if (iat * 1000 < u.sessionsValidAfter.getTime() - 1000) return null;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      depot: u.depot,
      outletId: u.outletId,
      vehicleId: u.vehicleId,
      sid,
      issuedAt: iat,
    };
  }

  async profile(user: SessionUser) {
    let outlet: { outletId: string; name: string; brand: string; district: string } | null = null;
    if (user.outletId) {
      const [o] = await this.db
        .select({ outletId: outlets.outletId, name: outlets.name, brand: outlets.brand, district: outlets.district })
        .from(outlets)
        .where(eq(outlets.outletId, user.outletId));
      outlet = o ?? null;
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      depot: user.depot,
      vehicleId: user.vehicleId,
      outlet,
    };
  }

  async sessions(user: SessionUser) {
    const rows = await this.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt), isNull(refreshTokens.usedAt)));
    return rows.map((r) => ({
      id: r.familyId,
      device: r.userAgent ?? 'Unknown device',
      lastUsedAt: (r.lastUsedAt ?? r.createdAt).toISOString(),
      current: r.familyId === user.sid,
    }));
  }

  async revokeSession(user: SessionUser, familyId: string, meta: AuditMeta): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), eq(refreshTokens.userId, user.id)));
    await this.audit.record(user, 'auth.session_revoked', { type: 'session', id: familyId }, {}, meta);
  }

  /** SEC-07: current password required, policy enforced, all other sessions revoked. */
  async changePassword(user: SessionUser, current: string, next: string, meta: AuditMeta): Promise<void> {
    const [u] = await this.db.select().from(users).where(eq(users.id, user.id));
    if (!u || !(await verifyPassword(u.passwordHash, current))) {
      throw new AppError('invalid_credentials', 'Your current password is not correct.', HttpStatus.UNAUTHORIZED);
    }
    const problem = passwordPolicyError(next);
    if (problem) throw new AppError('weak_password', problem, HttpStatus.BAD_REQUEST);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, user.id));
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt), ne(refreshTokens.familyId, user.sid)));
    });
    await this.audit.record(user, 'auth.password_changed', { type: 'user', id: user.id }, {}, meta);
  }
}
