import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

export const DB = Symbol('DB');
export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Db =>
        drizzle(
          new pg.Pool({
            // Runtime uses the least-privilege role when configured (SEC-60).
            connectionString: env.APP_DATABASE_URL ?? env.DATABASE_URL,
            max: 15,
            // SEC-62: bounded queries and transactions.
            statement_timeout: 10_000,
            idle_in_transaction_session_timeout: 15_000,
            connectionTimeoutMillis: 5_000,
          }),
          { schema },
        ),
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
