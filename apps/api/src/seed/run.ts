// One-shot job: migrations → least-privilege DB role → reference data → users → demo data.
// Runs as the `migrate` compose service before the API starts, and via `pnpm db:seed` on the host.
import '../env.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from '../db/schema.js';
import type { Db } from '../db/drizzle.module.js';
import { capacityReport, clearTransactional, seedDemo, seedUsers } from './demo.js';
import { EXPECTED, seedReference } from './reference.js';
import { SeedError } from './csv.js';

const log = (m: string) => console.log(m);
const here = fileURLToPath(new URL('.', import.meta.url));

/** SEC-60: the API connects as `wayflow_app` with DML only; the audit log is insert/select only. */
async function ensureAppRole(db: Db) {
  if (!env.APP_DB_PASSWORD) {
    log('  app role: APP_DB_PASSWORD not set, API uses the owner connection (dev only)');
    return;
  }
  const pw = env.APP_DB_PASSWORD.replace(/'/g, "''");
  await db.execute(
    sql.raw(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wayflow_app') THEN
        CREATE ROLE wayflow_app LOGIN PASSWORD '${pw}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
      ELSE
        ALTER ROLE wayflow_app WITH LOGIN PASSWORD '${pw}';
      END IF;
    END $$;`),
  );
  await db.execute(sql`GRANT USAGE ON SCHEMA public TO wayflow_app`);
  await db.execute(sql`REVOKE CREATE ON SCHEMA public FROM wayflow_app`);
  await db.execute(sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wayflow_app`);
  await db.execute(sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wayflow_app`);
  await db.execute(sql`REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM wayflow_app`);
  // Reference data is read-only for the app.
  for (const t of ['outlets', 'vehicles', 'calendar_days', 'district_travel', 'service_allowances', 'traffic_speeds', 'road_conditions', 'unit_profiles']) {
    await db.execute(sql.raw(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ${t} FROM wayflow_app`));
  }
  log('  app role: wayflow_app granted DML (audit_log append-only, reference data read-only)');
}

async function counts(db: Db) {
  const q = async (t: string) => ((await db.execute(sql.raw(`select count(*)::int as n from ${t}`))).rows[0] as { n: number }).n;
  const got = {
    outlets: await q('outlets'),
    vehicles: await q('vehicles'),
    calendar: await q('calendar_days'),
    districtTravel: await q('district_travel'),
    serviceAllowance: await q('service_allowances'),
    trafficSpeed: await q('traffic_speeds'),
    roadConditions: await q('road_conditions'),
  };
  for (const [k, v] of Object.entries(got)) {
    const want = EXPECTED[k as keyof typeof EXPECTED];
    if (v !== want) throw new SeedError(`Row count check failed for ${k}: expected ${want}, found ${v}`);
  }
  return got;
}

export async function main(opts: { reset?: boolean } = {}) {
  const started = Date.now();
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 4 });
  const db = drizzle(pool, { schema }) as unknown as Db;
  try {
    log('WayFlow migrate + seed');
    await migrate(db, { migrationsFolder: resolve(here, '../../drizzle') });
    log('  migrations applied');
    await ensureAppRole(db);
    const dataDir = resolve(process.cwd(), env.DATA_DIR);
    const { history, checksum } = await seedReference(db, dataDir, log);
    const c = await counts(db);
    log(`  reference rows: ${Object.entries(c).map(([k, v]) => `${k}=${v}`).join(' ')} (checksum ${checksum})`);
    await seedUsers(db, env.SEED_DEFAULT_PASSWORD, log);
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from orders`)).rows as [{ n: number }];
    if (opts.reset || n === 0) {
      if (n) await clearTransactional(db);
      await seedDemo(db, dataDir, history, log);
      await capacityReport(db, log);
    } else {
      log(`  demo data: ${n} orders already present, left untouched (run \`pnpm db:reset-demo\` to restore the demo state)`);
    }
    log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main({ reset: process.argv.includes('--reset') }).catch((e) => {
    console.error(e instanceof SeedError ? `Seed failed: ${e.message}` : e);
    process.exit(1);
  });
}
