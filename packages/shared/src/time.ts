// Time helpers. All business times are Asia/Colombo (UTC+05:30, no DST).
// Times of day are stored as minutes since local midnight.

export const COLOMBO_OFFSET_MIN = 330;
export const CUTOFF_MIN = 16 * 60;

/** "05:30" -> 330. Throws on malformed input. */
export function hhmmToMin(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Invalid HH:MM value: "${value}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new Error(`Invalid HH:MM value: "${value}"`);
  return h * 60 + min;
}

/** 330 -> "05:30". Values past midnight wrap (e.g. 1450 -> "00:10"). */
export function minToHhmm(total: number): string {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Calendar date (YYYY-MM-DD) and minute-of-day of an instant, in Colombo time. */
export function colomboParts(instant: Date): { date: string; minute: number } {
  const shifted = new Date(instant.getTime() + COLOMBO_OFFSET_MIN * 60_000);
  const date = shifted.toISOString().slice(0, 10);
  return { date, minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

/** Instant for a Colombo-local date + minute of day. */
export function colomboInstant(date: string, minute: number): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d, 0, minute) - COLOMBO_OFFSET_MIN * 60_000);
}

export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

/** ISO weekday, Monday = 0 … Sunday = 6 (matches calendar.csv `dow`). */
export function weekdayIndex(date: string): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
}

/** Monday of the ISO week containing `date`. */
export function isoWeekStart(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "2026-05-20" -> "20 May". */
export function formatDayMonth(date: string): string {
  const [, mo, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[mo - 1]}`;
}

/** "2026-05-20" -> "20 May 2026". */
export function formatDate(date: string): string {
  return `${formatDayMonth(date)} ${date.slice(0, 4)}`;
}

/** "2026-05-20" -> "Wednesday 20 May 2026". */
export function formatLongDate(date: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return `${DAYS_LONG[weekdayIndex(date)]} ${d} ${MONTHS_LONG[mo - 1]} ${y}`;
}
