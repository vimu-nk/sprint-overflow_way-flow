import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { changePasswordSchema, loginSchema } from '@wayflow/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser, Public, type SessionUser, SkipCsrfToken } from '../common/decorators.js';
import { AppError } from '../common/errors.js';
import { parse } from '../common/zod.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import { ACCESS_TTL_SEC, COOKIE, cookieBase, csrfTokenFor, REFRESH_PATH, safeEqual } from './tokens.js';
import { originAllowed } from './guards.js';
import { DB, type Db } from '../db/drizzle.module.js';
import { refreshTokens } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { hashRefreshToken } from './tokens.js';

export const meta = (req: FastifyRequest) => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'] ?? null,
  requestId: String(req.id),
});

function setSessionCookies(reply: FastifyReply, s: IssuedSession) {
  void reply.setCookie(COOKIE.access, s.accessToken, { ...cookieBase, maxAge: ACCESS_TTL_SEC });
  void reply.setCookie(COOKIE.refresh, s.refreshToken, {
    ...cookieBase,
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: s.refreshMaxAgeSec,
  });
  // Readable by the SPA so it can echo it in X-CSRF-Token.
  void reply.setCookie(COOKIE.csrf, csrfTokenFor(s.sid), { ...cookieBase, httpOnly: false, maxAge: s.refreshMaxAgeSec });
}

function clearSessionCookies(reply: FastifyReply) {
  void reply.clearCookie(COOKIE.access, { ...cookieBase });
  void reply.clearCookie(COOKIE.refresh, { ...cookieBase, sameSite: 'strict', path: REFRESH_PATH });
  void reply.clearCookie(COOKIE.csrf, { ...cookieBase, httpOnly: false });
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() body: unknown, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!originAllowed(req)) throw new AppError('csrf_failed', 'Request origin not allowed.', 403);
    const { email, password } = parse(loginSchema, body);
    const session = await this.auth.login(email, password, { ...meta(req), ip: req.ip });
    setSessionCookies(reply, session);
    return { role: session.user.role };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!originAllowed(req)) throw new AppError('csrf_failed', 'Request origin not allowed.', 403);
    const token = req.cookies?.[COOKIE.refresh];
    if (!token) throw new AppError('session_expired', 'Your session has ended. Sign in again.', 401);
    // Double-submit check bound to the refresh family.
    const [row] = await this.db.select({ familyId: refreshTokens.familyId }).from(refreshTokens).where(eq(refreshTokens.tokenHash, hashRefreshToken(token)));
    const header = req.headers['x-csrf-token'];
    if (row && (typeof header !== 'string' || !safeEqual(header, csrfTokenFor(row.familyId)))) {
      throw new AppError('csrf_failed', 'Security token missing or stale. Reload the page.', 403);
    }
    try {
      const session = await this.auth.refresh(token, meta(req));
      setSessionCookies(reply, session);
      return { role: session.user.role };
    } catch (e) {
      if (e instanceof AppError && e.code === 'session_expired') clearSessionCookies(reply);
      throw e;
    }
  }

  @Public()
  @SkipCsrfToken()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    if (!originAllowed(req)) throw new AppError('csrf_failed', 'Request origin not allowed.', 403);
    const token = req.cookies?.[COOKIE.refresh];
    if (token) await this.auth.revokeByRefreshToken(token);
    clearSessionCookies(reply);
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: SessionUser, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(user, meta(req), true);
    clearSessionCookies(reply);
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return this.auth.profile(user);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: SessionUser) {
    return this.auth.sessions(user);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.auth.revokeSession(user, id, meta(req));
  }

  @Post('password')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  async changePassword(@CurrentUser() user: SessionUser, @Body() body: unknown, @Req() req: FastifyRequest) {
    const dto = parse(changePasswordSchema, body);
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword, meta(req));
  }
}
