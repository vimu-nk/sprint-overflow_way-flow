import { z } from 'zod';

export * from './enums.js';
export * from './time.js';
export * from './labels.js';
export * from './schemas.js';
export * from './state-machines.js';
export * from './rules/types.js';
export * from './rules/trip-time.js';
export * from './rules/schedule.js';
export * from './rules/validate.js';
export * from './rules/cutoff.js';
export * from './rules/priority.js';
export * from './api-types.js';

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.boolean(),
  valkey: z.boolean(),
  storage: z.boolean(),
  planner: z.boolean(),
});

export type Health = z.infer<typeof healthSchema>;
