import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Depot, Role, Severity } from '@wayflow/shared';
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Valkey } from 'iovalkey';
import { ClockService } from '../clock/clock.service.js';
import { DB, type Db } from '../db/drizzle.module.js';
import { notifications, users } from '../db/schema.js';
import { VALKEY } from '../valkey/valkey.module.js';

/** Who gets an event. Resolved to concrete users at fan-out time (SEC-79: never broadcast). */
export interface Audience {
  userIds?: string[];
  roles?: Role[];
  depots?: { role: Role; depot: Depot }[];
  outletIds?: string[];
  vehicleIds?: string[];
}

export interface NotifyInput {
  type: string;
  severity: Severity;
  title: string;
  body: string;
  link?: string;
  to: Audience;
}

/** Messages on the SSE stream: a stored notification, or a cache-invalidation hint. */
export type StreamEvent =
  | { kind: 'notification'; id: string; type: string; severity: Severity; title: string; body: string; link: string | null; createdAt: string }
  | { kind: 'invalidate'; keys: string[] };

type Listener = (e: StreamEvent) => void;
const CHANNEL = 'wayflow:events';

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Notifications');
  private readonly listeners = new Map<string, Set<Listener>>();
  private sub: Valkey | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Valkey,
    private readonly clock: ClockService,
  ) {}

  async onModuleInit() {
    // Pub/sub so several API instances can share one stream fan-out.
    this.sub = this.valkey.duplicate();
    this.sub.on('message', (_ch: string, raw: string) => {
      try {
        const msg = JSON.parse(raw) as { userIds: string[]; event: StreamEvent };
        for (const id of msg.userIds) this.listeners.get(id)?.forEach((l) => l(msg.event));
      } catch (e) {
        this.log.warn({ err: e }, 'bad pubsub message');
      }
    });
    this.sub.on('error', (e) => this.log.warn({ err: e }, 'valkey subscriber error'));
    await this.sub.subscribe(CHANNEL).catch((e) => this.log.warn({ err: e }, 'subscribe failed'));
  }

  async onModuleDestroy() {
    await this.sub?.quit().catch(() => undefined);
  }

  subscribe(userId: string, l: Listener): () => void {
    const set = this.listeners.get(userId) ?? new Set();
    set.add(l);
    this.listeners.set(userId, set);
    return () => {
      set.delete(l);
      if (!set.size) this.listeners.delete(userId);
    };
  }

  connectionCount(userId: string): number {
    return this.listeners.get(userId)?.size ?? 0;
  }

  private async publish(userIds: string[], event: StreamEvent) {
    if (!userIds.length) return;
    try {
      await this.valkey.publish(CHANNEL, JSON.stringify({ userIds, event }));
    } catch {
      // Valkey down: deliver locally so a single instance still works.
      for (const id of userIds) this.listeners.get(id)?.forEach((l) => l(event));
    }
  }

  async resolve(to: Audience): Promise<string[]> {
    const conds: SQL[] = [];
    if (to.userIds?.length) conds.push(inArray(users.id, to.userIds));
    if (to.roles?.length) conds.push(inArray(users.role, to.roles));
    for (const d of to.depots ?? []) conds.push(and(eq(users.role, d.role), eq(users.depot, d.depot))!);
    if (to.outletIds?.length) conds.push(and(eq(users.role, 'store_manager'), inArray(users.outletId, to.outletIds))!);
    if (to.vehicleIds?.length) conds.push(and(eq(users.role, 'driver'), inArray(users.vehicleId, to.vehicleIds))!);
    if (!conds.length) return [];
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.isActive, true), or(...conds)));
    return [...new Set(rows.map((r) => r.id))];
  }

  /** Store one row per recipient and push it live. Called by domain services, not controllers. */
  async notify(input: NotifyInput): Promise<number> {
    const userIds = await this.resolve(input.to);
    if (!userIds.length) return 0;
    const createdAt = await this.clock.now();
    const rows = await this.db
      .insert(notifications)
      .values(
        userIds.map((userId) => ({
          userId,
          type: input.type,
          severity: input.severity,
          title: input.title.slice(0, 120),
          body: input.body.slice(0, 280),
          link: input.link ?? null,
          createdAt,
        })),
      )
      .returning();
    for (const r of rows) {
      await this.publish([r.userId], {
        kind: 'notification',
        id: r.id,
        type: r.type,
        severity: r.severity,
        title: r.title,
        body: r.body,
        link: r.link,
        createdAt: r.createdAt.toISOString(),
      });
    }
    return rows.length;
  }

  /** Tell open screens to refetch (TanStack Query keys) without storing anything. */
  async invalidate(to: Audience, keys: string[]): Promise<void> {
    const userIds = await this.resolve(to);
    await this.publish(userIds, { kind: 'invalidate', keys });
  }

  async list(userId: string, opts: { unreadOnly: boolean; limit: number; before?: string }) {
    const conds: SQL[] = [eq(notifications.userId, userId)];
    if (opts.unreadOnly) conds.push(isNull(notifications.readAt));
    if (opts.before) conds.push(lt(notifications.createdAt, new Date(opts.before)));
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(...conds))
      .orderBy(desc(notifications.createdAt))
      .limit(opts.limit);
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      severity: r.severity,
      title: r.title,
      body: r.body,
      link: r.link,
      createdAt: r.createdAt.toISOString(),
      readAt: r.readAt?.toISOString() ?? null,
    }));
  }

  async unreadCount(userId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return r?.n ?? 0;
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)));
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }
}
