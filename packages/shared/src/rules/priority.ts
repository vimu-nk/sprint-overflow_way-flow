import type { Brand, TempRequirement } from '../enums.js';

/**
 * Default prioritisation policy (specs/03 §9). Higher score = served first.
 * The planner receives these scores as objective weights, so the policy lives in one place.
 */
export interface PriorityInput {
  brand: Brand;
  temp: TempRequirement;
  deferredYesterday: boolean;
  daysSinceLastServed: number;
  windowCloseMin: number;
}

export const POLICY_STEPS = [
  'Outlets deferred on the last run, or not served recently, go first. The same outlet is never skipped on consecutive runs if any vehicle can take it.',
  'Fresh chilled orders next, earliest window close first.',
  'Fresh ambient orders.',
  'Tech orders (high value, single large items) in the trading-day budget.',
  'Style orders (volume-heavy, mall windows) fill the remaining volume.',
] as const;

export function priorityScore(o: PriorityInput): number {
  let score = 0;
  if (o.deferredYesterday) score += 10_000;
  score += Math.min(o.daysSinceLastServed, 14) * 300;
  if (o.brand === 'Fresh') score += o.temp === 'chilled' ? 3_000 : 2_000;
  else if (o.brand === 'Tech') score += 1_200;
  else score += 1_000;
  // Earlier window close breaks ties inside a class (0–480 bonus).
  score += Math.max(0, 1440 - o.windowCloseMin) / 3;
  return Math.round(score);
}
