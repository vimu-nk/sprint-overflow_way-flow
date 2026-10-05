import { Module } from '@nestjs/common';
import { PlannerClient } from './planner.client.js';
import { PlanStore } from './plan-store.js';
import { PlanningService } from './planning.service.js';

@Module({ providers: [PlanningService, PlanStore, PlannerClient], exports: [PlanningService, PlanStore] })
export class PlanningModule {}
