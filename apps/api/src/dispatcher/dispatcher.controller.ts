import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import {
  deferOrderSchema,
  deferralReasonSchema,
  DEPOTS,
  moveOrderSchema,
  publishSchema,
  resolveExceptionSchema,
  runPlanSchema,
  vehicleStatusSchema,
} from '@wayflow/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { meta } from '../auth/auth.controller.js';
import { CurrentUser, Roles, type SessionUser } from '../common/decorators.js';
import { parse } from '../common/zod.js';
import { PlanningService } from '../planning/planning.service.js';
import { DispatcherActions } from './dispatcher.actions.js';
import { DispatcherService } from './dispatcher.service.js';

const dateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict();
const searchQuery = z.object({ q: z.string().trim().min(2).max(40), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict();
const vehicleParam = z.string().regex(/^VEH\d{3}$/);
const outletParam = z.string().regex(/^OUT\d{3}$/);

/** Dispatcher API. Dispatchers see both depots (specs/19 SEC-26). */
@Controller('dispatcher')
@Roles('dispatcher')
export class DispatcherController {
  constructor(
    private readonly svc: DispatcherService,
    private readonly planning: PlanningService,
    private readonly actions: DispatcherActions,
  ) {}

  private async date(q: unknown) {
    return this.svc.runDate(parse(dateQuery, q).date);
  }

  @Get('orders')
  async queue(@Query() q: unknown) {
    return this.svc.queue(await this.date(q));
  }

  @Get('plans')
  async board(@Query() q: unknown) {
    return this.svc.board(await this.date(q));
  }

  @Post('plans/run')
  @HttpCode(200)
  async run(@Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: FastifyRequest) {
    const dto = parse(runPlanSchema, body);
    return this.planning.run(dto.date, dto.depot, user, meta(req));
  }

  @Post('plans/:id/publish')
  @HttpCode(200)
  publish(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: FastifyRequest) {
    const dto = parse(publishSchema, body);
    return this.planning.publish(id, dto.acknowledgeSecondDeferrals, user, meta(req));
  }

  @Get('plans/:id/policy')
  policy(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.policy(id);
  }

  @Get('trips/:id')
  trip(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.trip(id);
  }

  @Post('moves')
  @HttpCode(200)
  move(@Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: FastifyRequest) {
    const dto = parse(moveOrderSchema, body);
    return this.planning.move(dto.orderId, dto.vehicleId, dto.tripNo, dto.reason, dto.dryRun, user, meta(req));
  }

  @Post('defer')
  @HttpCode(204)
  async defer(@Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: FastifyRequest) {
    const dto = parse(deferOrderSchema, body);
    await this.planning.defer(dto.orderId, dto.reasonCode, dto.reason, dto.acknowledgeSecondDeferral, user, meta(req));
  }

  @Put('deferrals/:orderId/reason')
  @HttpCode(204)
  async reason(@Param('orderId', ParseUUIDPipe) orderId: string, @Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: FastifyRequest) {
    await this.planning.setDeferralReason(orderId, parse(deferralReasonSchema, body).reason, user, meta(req));
  }

  @Get('deferrals')
  async deferrals(@Query() q: unknown) {
    return this.svc.deferrals(await this.date(q));
  }

  @Get('live')
  async live(@Query() q: unknown) {
    return this.svc.live(await this.date(q));
  }

  @Get('exceptions')
  async exceptions(@Query() q: unknown) {
    return this.svc.exceptions(await this.date(q));
  }

  @Get('exceptions/:id')
  exception(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.exception(id);
  }

  @Post('exceptions/:id/resolve')
  @HttpCode(204)
  async resolve(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: FastifyRequest) {
    await this.actions.resolveException(id, parse(resolveExceptionSchema, body).resolution, user, meta(req));
  }

  @Post('orders/:id/reschedule')
  @HttpCode(204)
  async reschedule(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: FastifyRequest) {
    await this.actions.rescheduleFailed(id, parse(deferralReasonSchema, body).reason, user, meta(req));
  }

  @Get('fleet')
  async fleet(@Query() q: unknown) {
    return this.svc.fleet(await this.date(q));
  }

  @Put('fleet/:vehicleId')
  setVehicle(@Param('vehicleId') vehicleId: string, @Body() body: unknown, @CurrentUser() user: SessionUser, @Req() req: FastifyRequest) {
    const dto = parse(vehicleStatusSchema, body);
    return this.planning.setVehicleStatus(parse(vehicleParam, vehicleId), dto.date, dto.status, dto.note, user, meta(req));
  }

  @Get('outlets/:outletId')
  outlet(@Param('outletId') outletId: string) {
    return this.svc.outletHistory(parse(outletParam, outletId));
  }

  @Get('search')
  async search(@Query() q: unknown) {
    const dto = parse(searchQuery, q);
    return this.svc.search(dto.q, await this.svc.runDate(dto.date));
  }

  @Get('depots')
  depots() {
    return DEPOTS;
  }
}
