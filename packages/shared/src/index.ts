import { z } from 'zod';

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.boolean(),
  valkey: z.boolean(),
  storage: z.boolean(),
  planner: z.boolean(),
});

export type Health = z.infer<typeof healthSchema>;
