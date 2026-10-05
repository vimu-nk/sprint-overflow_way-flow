import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { syncBatchSchema } from '@wayflow/shared';
import type { FastifyRequest } from 'fastify';
import { meta } from '../auth/auth.controller.js';
import { CurrentUser, Roles, type SessionUser } from '../common/decorators.js';
import { parse } from '../common/zod.js';
import { FieldService } from './field.service.js';
import { SyncService } from './sync.service.js';

@Controller('loader')
@Roles('loader')
export class LoaderController {
  constructor(private readonly field: FieldService) {}

  @Get('trips')
  trips(@CurrentUser() user: SessionUser) {
    return this.field.loaderTrips(user);
  }

  @Get('trips/:id')
  trip(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.field.loaderTripDetail(user, id);
  }

  @Post('trips/:id/seen')
  @HttpCode(204)
  async seen(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.field.markSeen(await this.field.loaderTrip(user, id));
  }
}

@Controller('driver')
@Roles('driver')
export class DriverController {
  constructor(private readonly field: FieldService) {}

  @Get('run')
  run(@CurrentUser() user: SessionUser) {
    return this.field.driverRun(user);
  }

  @Post('trips/:id/seen')
  @HttpCode(204)
  async seen(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.field.markSeen(await this.field.driverTrip(user, id));
  }
}

/** Offline outbox endpoint (specs/08 §3). ≤ 100 actions, 30 batches/min per user (SEC-76). */
@Controller('sync')
@Roles('loader', 'driver')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('batch')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async batch(@CurrentUser() user: SessionUser, @Body() body: unknown, @Req() req: FastifyRequest) {
    const batch = parse(syncBatchSchema, body);
    return { results: await this.sync.process(user, batch, meta(req)) };
  }
}
