import { type ExecutionContext, Injectable, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AttachmentsModule } from './attachments/attachments.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard, CsrfGuard, RolesGuard } from './auth/guards.js';
import { ClockModule } from './clock/clock.module.js';
import { AllExceptionsFilter } from './common/exception.filter.js';
import { DrizzleModule } from './db/drizzle.module.js';
import { DevModule } from './dev/dev.module.js';
import { DispatcherModule } from './dispatcher/dispatcher.module.js';
import { ExceptionsModule } from './exceptions/exceptions.module.js';
import { FieldModule } from './field/field.module.js';
import { HealthController } from './health/health.controller.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ReferenceModule } from './reference/reference.module.js';
import { StorageModule } from './storage/storage.module.js';
import { StoreModule } from './store/store.module.js';
import { ValkeyModule } from './valkey/valkey.module.js';
import { ViewsModule } from './views/views.module.js';

/** Rate limit per signed-in user, or per client IP before sign-in (SEC-50). */
@Injectable()
class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id?: string } | undefined;
    return user?.id ? `u:${user.id}` : `ip:${String(req.ip)}`;
  }

  override canActivate(ctx: ExecutionContext) {
    return super.canActivate(ctx);
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    DrizzleModule,
    ValkeyModule,
    StorageModule,
    AuditModule,
    ClockModule,
    ReferenceModule,
    NotificationsModule,
    ExceptionsModule,
    ViewsModule,
    AuthModule,
    StoreModule,
    DispatcherModule,
    FieldModule,
    AttachmentsModule,
    DevModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: authenticate, throttle per user, check role, then CSRF for writes.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
