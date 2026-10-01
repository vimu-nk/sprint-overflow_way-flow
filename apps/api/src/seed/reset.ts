import { resolve } from 'node:path';
import type { Db } from '../db/drizzle.module.js';
import { env } from '../env.js';
import { clearTransactional, seedDemo } from './demo.js';
import { readHistory } from './reference.js';

/** X-09: wipe orders, plans and field events, then reload the demo orders. Users and reference data stay. */
export async function resetDemo(db: Db): Promise<void> {
  const dataDir = resolve(process.cwd(), env.DATA_DIR);
  const { history } = readHistory(dataDir);
  await clearTransactional(db);
  await seedDemo(db, dataDir, history, () => undefined);
}
