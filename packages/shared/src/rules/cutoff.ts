import { addDays, CUTOFF_MIN } from '../time.js';

/**
 * Cutoff rule (specs/03 §7, F12): orders for run date R close at 16:00 on the day before R.
 * An order placed at (date, minute) goes to the first operating day whose cutoff has not
 * passed. Non-operating days (Sundays, holidays) are skipped.
 */
export function targetRunDate(
  nowDate: string,
  nowMinute: number,
  isOperating: (date: string) => boolean,
): string {
  for (let i = 1; i <= 21; i++) {
    const run = addDays(nowDate, i);
    if (!isOperating(run)) continue;
    const cutoffDate = addDays(run, -1);
    const beforeCutoff = cutoffDate > nowDate || (cutoffDate === nowDate && nowMinute < CUTOFF_MIN);
    if (beforeCutoff) return run;
  }
  throw new Error(`No operating day within 3 weeks of ${nowDate}`);
}

/** True while orders for `runDate` can still be placed, edited or cancelled. */
export function isBeforeCutoff(runDate: string, nowDate: string, nowMinute: number): boolean {
  const cutoffDate = addDays(runDate, -1);
  return cutoffDate > nowDate || (cutoffDate === nowDate && nowMinute < CUTOFF_MIN);
}

/** Minutes left until the cutoff for `runDate` (negative once passed). */
export function minutesToCutoff(runDate: string, nowDate: string, nowMinute: number): number {
  const cutoffDate = addDays(runDate, -1);
  const dayDiff = Math.round((Date.parse(cutoffDate) - Date.parse(nowDate)) / 86_400_000);
  return dayDiff * 1440 + CUTOFF_MIN - nowMinute;
}

/** Calendar fallback outside calendar.csv (specs/10 §4): Sunday is closed, every other day operates. */
export function fallbackIsOperating(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0;
}
