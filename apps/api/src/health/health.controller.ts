import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Health } from '@wayflow/shared';
import { sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { Valkey } from 'iovalkey';
import { Public } from '../common/decorators.js';
import { DB, type Db } from '../db/drizzle.module.js';
import { env } from '../env.js';
import { BUCKET, S3 } from '../storage/storage.module.js';
import { VALKEY } from '../valkey/valkey.module.js';

const ok = (p: Promise<unknown>) =>
  Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 2000))]).catch(() => false);

/** Liveness and readiness. No versions or configuration in the output (SEC-56). */
@Controller()
@Public()
@SkipThrottle()
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Valkey,
    @Inject(S3) private readonly s3: S3Client,
  ) {}

  private async checks(): Promise<Health> {
    const [db, valkey, storage, planner] = await Promise.all([
      ok(this.db.execute(sql`select 1`)),
      ok(this.valkey.ping()),
      ok(this.s3.send(new HeadBucketCommand({ Bucket: BUCKET }))),
      ok(fetch(`${env.PLANNER_URL}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok || Promise.reject(new Error('down')))),
    ]);
    return { status: db && valkey && storage && planner ? 'ok' : 'degraded', db, valkey, storage, planner };
  }

  /** Dependency status for the dashboard and compose healthcheck. The planner being down is "degraded", not dead. */
  @Get('health')
  health(): Promise<Health> {
    return this.checks();
  }

  @Get('ready')
  async ready(@Res() reply: FastifyReply) {
    const h = await this.checks();
    const ready = h.db && h.storage;
    return reply.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).send({ status: ready ? 'ok' : 'fail' });
  }
}
