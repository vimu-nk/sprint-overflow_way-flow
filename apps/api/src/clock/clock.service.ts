import { Inject, Injectable } from '@nestjs/common';
import { type ClockDto, colomboInstant, colomboParts, fallbackIsOperating, hhmmToMin, minToHhmm, minutesToCutoff, targetRunDate } from '@wayflow/shared';
import { eq, inArray } from 'drizzle-orm';
import { DB, type Db } from '../db/drizzle.module.js';
import { appSettings, calendarDays } from '../db/schema.js';
import { env } from '../env.js';

interface ClockSetting {
  /** Simulated instant at the anchor. */
  anchorSim: string;
  /** Real instant when the anchor was set. Simulated time runs at real speed from here. */
  anchorReal: string;
}

export const CLOCK_KEY = 'simulation_clock';

/**
 * Simulation clock (specs/10 §4). The calendar data ends on 2026-06-28, so "now" is a
 * simulated Asia/Colombo instant that advances in real time from an anchor stored in the DB.
 */
@Injectable()
export class ClockService {
  private cache: { setting: ClockSetting; loadedAt: number } | null = null;
  private operating = new Map<string, boolean>();

  constructor(@Inject(DB) private readonly db: Db) {}

  static defaultSetting(now = new Date()): ClockSetting {
    return {
      anchorSim: colomboInstant(env.APP_SIMULATION_DATE, hhmmToMin(env.APP_SIMULATION_TIME)).toISOString(),
      anchorReal: now.toISOString(),
    };
  }

  private async setting(): Promise<ClockSetting> {
    if (this.cache && Date.now() - this.cache.loadedAt < 5_000) return this.cache.setting;
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.key, CLOCK_KEY));
    const setting = (row?.value as ClockSetting | undefined) ?? ClockService.defaultSetting();
    this.cache = { setting, loadedAt: Date.now() };
    return setting;
  }

  async now(): Promise<Date> {
    const s = await this.setting();
    return new Date(Date.parse(s.anchorSim) + (Date.now() - Date.parse(s.anchorReal)));
  }

  async parts(): Promise<{ now: Date; date: string; minute: number }> {
    const now = await this.now();
    return { now, ...colomboParts(now) };
  }

  async set(date: string, minute: number): Promise<void> {
    const value: ClockSetting = { anchorSim: colomboInstant(date, minute).toISOString(), anchorReal: new Date().toISOString() };
    await this.db
      .insert(appSettings)
      .values({ key: CLOCK_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    this.cache = null;
  }

  /** Calendar lookup with the documented fallback outside calendar.csv. */
  async isOperatingMap(dates: string[]): Promise<Map<string, boolean>> {
    const missing = dates.filter((d) => !this.operating.has(d));
    if (missing.length) {
      const rows = await this.db
        .select({ date: calendarDays.date, isOperating: calendarDays.isOperating })
        .from(calendarDays)
        .where(inArray(calendarDays.date, missing));
      const found = new Map(rows.map((r) => [r.date, r.isOperating]));
      for (const d of missing) this.operating.set(d, found.get(d) ?? fallbackIsOperating(d));
    }
    return new Map(dates.map((d) => [d, this.operating.get(d)!]));
  }

  async runDateFor(date: string, minute: number): Promise<string> {
    const candidates = Array.from({ length: 22 }, (_, i) => {
      const d = new Date(Date.parse(date) + i * 86_400_000).toISOString().slice(0, 10);
      return d;
    });
    const map = await this.isOperatingMap(candidates);
    return targetRunDate(date, minute, (d) => map.get(d) ?? fallbackIsOperating(d));
  }

  /** The next operating run after `date` (the run the dispatcher plans "today"). */
  async nextRunDate(date: string): Promise<string> {
    return this.runDateFor(date, 0);
  }

  async dto(): Promise<ClockDto> {
    const { now, date, minute } = await this.parts();
    const orderRunDate = await this.runDateFor(date, minute);
    const planningRunDate = await this.nextRunDate(date);
    const [cal] = await this.db.select().from(calendarDays).where(eq(calendarDays.date, planningRunDate));
    return {
      now: now.toISOString(),
      date,
      time: minToHhmm(minute),
      orderRunDate,
      planningRunDate,
      minutesToCutoff: minutesToCutoff(planningRunDate, date, minute),
      outsideCalendar: !cal,
      demoTools: env.ENABLE_DEMO_TOOLS,
      calendar: cal ? { isPayday: cal.isPayday, festival: cal.festival, festivalRamp: cal.festivalRamp, monsoon: cal.monsoon, isOperating: cal.isOperating } : null,
    };
  }
}
