import { Module } from '@nestjs/common';
import { PlanningModule } from '../planning/planning.module.js';
import { StoreController } from './store.controller.js';
import { StoreService } from './store.service.js';

@Module({ imports: [PlanningModule], controllers: [StoreController], providers: [StoreService] })
export class StoreModule {}
