import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { placeOrderSchema, receiptSchema } from '@wayflow/shared';
import type { FastifyRequest } from 'fastify';
import { meta } from '../auth/auth.controller.js';
import { CurrentUser, Roles, type SessionUser } from '../common/decorators.js';
import { parse } from '../common/zod.js';
import { StoreService } from './store.service.js';

@Controller('store')
@Roles('store_manager')
export class StoreController {
  constructor(private readonly svc: StoreService) {}

  @Get('home')
  home(@CurrentUser() user: SessionUser) {
    return this.svc.home(user);
  }

  @Get('orders')
  list(@CurrentUser() user: SessionUser) {
    return this.svc.list(user);
  }

  @Get('orders/:id')
  get(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(user, id);
  }

  @Post('orders')
  @HttpCode(201)
  place(@CurrentUser() user: SessionUser, @Body() body: unknown, @Req() req: FastifyRequest) {
    const dto = parse(placeOrderSchema, body);
    return this.svc.place(user, dto.chilledUnits, dto.ambientUnits, dto.clientActionId, meta(req));
  }

  @Post('orders/:id/cancel')
  @HttpCode(204)
  async cancel(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.svc.cancel(user, id, meta(req));
  }

  @Post('orders/:id/receipt')
  @HttpCode(200)
  receipt(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    return this.svc.receipt(user, id, parse(receiptSchema, body), meta(req));
  }
}
