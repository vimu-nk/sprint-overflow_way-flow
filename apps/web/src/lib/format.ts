import { formatDayMonth, formatLongDate } from '@wayflow/shared';

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
export const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US');
export const kg = (n: number) => `${fmtInt(n)} kg`;
export const m3 = (n: number) => `${fmt1(n)} m³`;
export const load = (w: number, v: number) => `${kg(w)}, ${m3(v)}`;
export const dayMonth = formatDayMonth;
export const longDate = formatLongDate;

/** HH:MM of an ISO instant in Asia/Colombo (UTC+05:30). */
export function hhmm(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(Date.parse(iso) + 330 * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function initials(name: string): string {
  return name
    .replace(/[^A-Za-z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}

/** Calendar date (YYYY-MM-DD) of an ISO instant in Asia/Colombo. */
export function colomboDate(iso: string): string {
  return new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
}
