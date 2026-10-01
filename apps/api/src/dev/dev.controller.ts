import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import { clockSchema, hhmmToMin } from '@wayflow/shared';
import type { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { meta } from '../auth/auth.controller.js';
import { verifyPassword } from '../auth/passwords.js';
import { ClockService } from '../clock/clock.service.js';
import { CurrentUser, Roles, type SessionUser } from '../common/decorators.js';
import { AppError } from '../common/errors.js';
import { parse } from '../common/zod.js';
import { DB, type Db } from '../db/drizzle.module.js';
import { users } from '../db/schema.js';
import { env } from '../env.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { resetDemo } from '../seed/reset.js';

const resetSchema = z.object({ password: z.string().min(1).max(128) }).strict();

/** Demo tools (SEC-30): feature-flagged, dispatcher only, audited; reset needs the password again (SEC-20). */
@Controller('dev')
@Roles('dispatcher')
export class DevController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private guard() {
    if (!env.ENABLE_DEMO_TOOLS) throw new AppError('not_found', 'Not found', HttpStatus.NOT_FOUND);
  }

  @Post('clock')
  @HttpCode(200)
  async setClock(@Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: FastifyRequest) {
    this.guard();
    const dto = parse(clockSchema, body);
    await this.clock.set(dto.date, hhmmToMin(dto.time));
    await this.audit.record(user, 'demo.clock', { type: 'clock' }, dto, meta(req));
    await this.notifications.invalidate({ roles: ['dispatcher', 'loader', 'driver', 'store_manager'] }, ['clock', 'plans', 'live', 'run', 'loads', 'store-orders']);
    return this.clock.dto();
  }

  @Post('reset')
  @HttpCode(200)
  async reset(@Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: FastifyRequest) {
    this.guard();
    const { password } = parse(resetSchema, body);
    const [u] = await this.db.select().from(users).where(eq(users.id, user.id));
    if (!u || !(await verifyPassword(u.passwordHash, password))) {
      throw new AppError('invalid_credentials', 'Password is not correct.', HttpStatus.UNAUTHORIZED);
    }
    await resetDemo(this.db);
    await this.clock.set(env.APP_SIMULATION_DATE, hhmmToMin(env.APP_SIMULATION_TIME));
    await this.audit.record(user, 'demo.reset', { type: 'demo' }, {}, meta(req));
    return { ok: true };
  }
}
