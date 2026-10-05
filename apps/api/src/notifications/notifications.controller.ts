import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, type SessionUser } from '../common/decorators.js';
import { AppError } from '../common/errors.js';
import { parse } from '../common/zod.js';
import { NotificationsService } from './notifications.service.js';

const MAX_STREAMS_PER_USER = 3;
const listQuery = z
  .object({
    unread: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.string().datetime().optional(),
  })
  .strict();

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser, @Query() q: unknown) {
    const query = parse(listQuery, q);
    return this.notifications.list(user.id, { unreadOnly: query.unread === 'true', limit: query.limit, before: query.before });
  }

  @Get('unread-count')
  async unread(@CurrentUser() user: SessionUser) {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@CurrentUser() user: SessionUser) {
    await this.notifications.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.markRead(user.id, id);
  }

  /** Server-sent events, cookie-authenticated, ≤ 3 streams per user, 25 s heartbeat (specs/09 §3). */
  @Get('stream')
  @SkipThrottle()
  stream(@CurrentUser() user: SessionUser, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    if (this.notifications.connectionCount(user.id) >= MAX_STREAMS_PER_USER) {
      throw new AppError('too_many_streams', 'Too many open live connections.', 429);
    }
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.write('retry: 5000\n\n');
    const unsubscribe = this.notifications.subscribe(user.id, (e) => {
      raw.write(`event: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    const heartbeat = setInterval(() => raw.write(': ping\n\n'), 25_000);
    // Server-side cap so dead connections never pile up.
    const maxAge = setTimeout(() => raw.end(), 30 * 60_000);
    const close = () => {
      clearInterval(heartbeat);
      clearTimeout(maxAge);
      unsubscribe();
    };
    req.raw.on('close', close);
  }
}
