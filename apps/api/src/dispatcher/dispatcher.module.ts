import { Module } from '@nestjs/common';
import { PlanningModule } from '../planning/planning.module.js';
import { DispatcherActions } from './dispatcher.actions.js';
import { DispatcherController } from './dispatcher.controller.js';
import { DispatcherService } from './dispatcher.service.js';

@Module({ imports: [PlanningModule], controllers: [DispatcherController], providers: [DispatcherService, DispatcherActions] })
export class DispatcherModule {}
