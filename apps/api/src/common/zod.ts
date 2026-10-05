import type { z } from 'zod';
import { AppError } from './errors.js';

/** Validate untrusted input with a shared zod schema (SEC-34). */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value ?? {});
  if (!r.success) {
    throw new AppError(
      'validation_failed',
      r.error.issues[0]?.message ?? 'Invalid input',
      400,
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}
