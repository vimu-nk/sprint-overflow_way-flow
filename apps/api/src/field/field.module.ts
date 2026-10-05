import { Module } from '@nestjs/common';
import { DriverController, LoaderController, SyncController } from './field.controller.js';
import { FieldService } from './field.service.js';
import { SignalWatcher } from './signal-watcher.js';
import { SyncService } from './sync.service.js';

@Module({ controllers: [LoaderController, DriverController, SyncController], providers: [FieldService, SyncService, SignalWatcher], exports: [FieldService] })
export class FieldModule {}
