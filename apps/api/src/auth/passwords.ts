import { readFileSync } from 'node:fs';
import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * Argon2id parameters (SEC-01): 46 MiB, 1 iteration, 1 lane — the OWASP recommended set.
 * Kept in one constant so `needsRehash` can compare stored hashes against it (SEC-04).
 */
export const ARGON2_PARAMS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 47_104,
  timeCost: 1,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_PARAMS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** True when the stored hash uses weaker parameters than the current config. */
export function needsRehash(stored: string): boolean {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(stored);
  if (!m) return true;
  const [mem, time, par] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mem < ARGON2_PARAMS.memoryCost || time < ARGON2_PARAMS.timeCost || par !== ARGON2_PARAMS.parallelism;
}

/** A precomputed hash so unknown e-mails still pay the cost of one verify (SEC-06). */
let dummyHash: Promise<string> | null = null;
export function dummyVerify(password: string): Promise<boolean> {
  dummyHash ??= hashPassword('wayflow-dummy-password-for-timing');
  return dummyHash.then((h) => verifyPassword(h, password)).then(() => false);
}

let common: Set<string> | null = null;
function commonPasswords(): Set<string> {
  if (!common) {
    const file = new URL('../../assets/common-passwords.txt', import.meta.url);
    common = new Set(
      readFileSync(file, 'utf8')
        .split('\n')
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean),
    );
  }
  return common;
}

/** NIST 800-63B style policy (SEC-05): 12–128 chars, any characters, no common passwords. */
export function passwordPolicyError(password: string): string | null {
  const length = [...password].length;
  if (length < 12) return 'Use at least 12 characters.';
  if (length > 128) return 'Use at most 128 characters.';
  if (commonPasswords().has(password.toLowerCase())) return 'This password is too common. Choose another.';
  return null;
}
