import { Module } from '@nestjs/common';
import { DrizzleModule } from './db/drizzle.module.js';
import { HealthController } from './health/health.controller.js';
import { StorageModule } from './storage/storage.module.js';
import { ValkeyModule } from './valkey/valkey.module.js';

@Module({
  imports: [DrizzleModule, ValkeyModule, StorageModule],
  controllers: [HealthController],
})
export class AppModule {}
