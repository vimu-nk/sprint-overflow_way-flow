import { Controller, Get } from '@nestjs/common';
import type { ClockDto } from '@wayflow/shared';
import { ClockService } from './clock.service.js';

@Controller('clock')
export class ClockController {
  constructor(private readonly clock: ClockService) {}

  /** Simulated "now", the run an order placed now goes to, and the cutoff countdown. */
  @Get()
  get(): Promise<ClockDto> {
    return this.clock.dto();
  }
}
