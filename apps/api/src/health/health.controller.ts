import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import { Controller, Get, Inject } from '@nestjs/common';
import type { Health } from '@wayflow/shared';
import { sql } from 'drizzle-orm';
import type { Valkey } from 'iovalkey';
import { DB, type Db } from '../db/drizzle.module.js';
import { BUCKET, S3 } from '../storage/storage.module.js';
import { VALKEY } from '../valkey/valkey.module.js';

const ok = (p: Promise<unknown>) => p.then(() => true).catch(() => false);

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Valkey,
    @Inject(S3) private readonly s3: S3Client,
  ) {}

  @Get()
  async check(): Promise<Health> {
    const plannerUrl = process.env.PLANNER_URL ?? 'http://localhost:8000';
    const [db, valkey, storage, planner] = await Promise.all([
      ok(this.db.execute(sql`select 1`)),
      ok(this.valkey.ping()),
      ok(this.s3.send(new HeadBucketCommand({ Bucket: BUCKET }))),
      ok(fetch(`${plannerUrl}/health`).then((r) => r.ok || Promise.reject())),
    ]);
    const status = db && valkey && storage && planner ? 'ok' : 'degraded';
    return { status, db, valkey, storage, planner };
  }
}
