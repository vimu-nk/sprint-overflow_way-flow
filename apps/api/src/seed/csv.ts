import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';

export class SeedError extends Error {}

/**
 * Strict CSV loader: header must match exactly and the row count must equal `expectedRows`
 * when given (specs/10 §1). Values come back as trimmed strings.
 */
export function loadCsv(dataDir: string, relPath: string, header: string[], expectedRows?: number): Record<string, string>[] {
  const path = join(dataDir, relPath);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new SeedError(`Missing dataset file: ${relPath}. Put the competition CSVs in data/source/ (see data/README.md).`);
  }
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
  const first = rows[0];
  const actual = first ? Object.keys(first) : [];
  if (actual.join(',') !== header.join(',')) {
    throw new SeedError(`${relPath}: unexpected header.\n  expected ${header.join(',')}\n  got      ${actual.join(',')}`);
  }
  if (expectedRows !== undefined && rows.length !== expectedRows) {
    throw new SeedError(`${relPath}: expected ${expectedRows} rows, found ${rows.length}.`);
  }
  return rows;
}

export function num(v: string | undefined, field: string, opts: { min?: number; max?: number } = {}): number {
  const n = Number(v);
  if (v === undefined || v === '' || !Number.isFinite(n)) throw new SeedError(`Bad number in ${field}: "${v}"`);
  if (opts.min !== undefined && n < opts.min) throw new SeedError(`${field} below ${opts.min}: ${n}`);
  if (opts.max !== undefined && n > opts.max) throw new SeedError(`${field} above ${opts.max}: ${n}`);
  return n;
}

export function flag(v: string | undefined, field: string): boolean {
  if (v === '1' || v === '1.0') return true;
  if (v === '0' || v === '0.0') return false;
  throw new SeedError(`Bad 0/1 flag in ${field}: "${v}"`);
}

export function oneOf<T extends string>(v: string | undefined, allowed: readonly T[], field: string): T {
  if (!allowed.includes(v as T)) throw new SeedError(`Unexpected ${field}: "${v}" (allowed: ${allowed.join(', ')})`);
  return v as T;
}

/** Deterministic PRNG (mulberry32) so the synthetic orders are reproducible (seed 20261004). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
