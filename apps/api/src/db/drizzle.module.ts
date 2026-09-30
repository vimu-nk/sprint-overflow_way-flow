import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export const DB = Symbol('DB');
export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Db =>
        drizzle(new pg.Pool({ connectionString: process.env.DATABASE_URL }), { schema }),
    },
  ],
  exports: [DB],
})
export class DrizzleModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown() {
    await this.db.$client.end();
  }
}
