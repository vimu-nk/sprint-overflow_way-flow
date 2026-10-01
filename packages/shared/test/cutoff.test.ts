import { describe, expect, it } from 'vitest';
import { fallbackIsOperating, hhmmToMin, isBeforeCutoff, minToHhmm, minutesToCutoff, priorityScore, targetRunDate } from '../src/index.js';

const operating = (d: string) => fallbackIsOperating(d);

describe('16:00 cutoff', () => {
  it('an order at 15:59 goes to the next morning run', () => {
    expect(targetRunDate('2026-05-19', hhmmToMin('15:59'), operating)).toBe('2026-05-20');
  });

  it('an order at 16:00 waits for the following run', () => {
    expect(targetRunDate('2026-05-19', hhmmToMin('16:00'), operating)).toBe('2026-05-21');
  });

  it('skips non-operating days (Saturday evening → Monday)', () => {
    expect(targetRunDate('2026-05-16', hhmmToMin('17:00'), operating)).toBe('2026-05-18');
  });

  it('edits close at the cutoff', () => {
    expect(isBeforeCutoff('2026-05-20', '2026-05-19', 959)).toBe(true);
    expect(isBeforeCutoff('2026-05-20', '2026-05-19', 960)).toBe(false);
    expect(minutesToCutoff('2026-05-20', '2026-05-19', 900)).toBe(60);
  });
});

describe('time helpers', () => {
  it('round-trips HH:MM', () => {
    expect(hhmmToMin('05:30')).toBe(330);
    expect(minToHhmm(330)).toBe('05:30');
    expect(() => hhmmToMin('25:00')).toThrow();
  });
});

describe('priority policy', () => {
  it('previously deferred outlets outrank everything else', () => {
    const base = { brand: 'Style' as const, temp: 'ambient' as const, daysSinceLastServed: 1, windowCloseMin: 1020 };
    const deferred = priorityScore({ ...base, deferredYesterday: true });
    const chilled = priorityScore({ brand: 'Fresh', temp: 'chilled', deferredYesterday: false, daysSinceLastServed: 1, windowCloseMin: 450 });
    expect(deferred).toBeGreaterThan(chilled);
  });

  it('Fresh chilled > Fresh ambient > Tech > Style', () => {
    const s = (brand: 'Fresh' | 'Style' | 'Tech', temp: 'ambient' | 'chilled') =>
      priorityScore({ brand, temp, deferredYesterday: false, daysSinceLastServed: 1, windowCloseMin: 480 });
    expect(s('Fresh', 'chilled')).toBeGreaterThan(s('Fresh', 'ambient'));
    expect(s('Fresh', 'ambient')).toBeGreaterThan(s('Tech', 'ambient'));
    expect(s('Tech', 'ambient')).toBeGreaterThan(s('Style', 'ambient'));
  });
});
