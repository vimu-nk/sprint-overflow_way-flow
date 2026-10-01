import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB, type Db } from '../db/drizzle.module.js';
import { auditLog } from '../db/schema.js';
import type { SessionUser } from '../common/decorators.js';

export interface AuditMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** Append-only audit trail (X-07, SEC-67). Never stores secrets. */
@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');

  constructor(@Inject(DB) private readonly db: Db) {}

  async record(
    actor: Pick<SessionUser, 'id' | 'role'> | null,
    action: string,
    entity: { type?: string; id?: string } = {},
    details: Record<string, unknown> = {},
    meta: AuditMeta = {},
    tx: Pick<Db, 'insert'> = this.db,
  ): Promise<void> {
    // Truncate IPv4 to /24 for privacy (SEC-67 "IP (truncated)").
    const ip = meta.ip ? meta.ip.replace(/^(\d+\.\d+\.\d+)\.\d+$/, '$1.0') : null;
    await tx.insert(auditLog).values({
      actorUserId: actor?.id ?? null,
      actorRole: actor?.role ?? null,
      action,
      entityType: entity.type ?? null,
      entityId: entity.id ?? null,
      details,
      ip: ip && /^[\d.:a-fA-F]+$/.test(ip) ? ip : null,
      userAgent: meta.userAgent?.slice(0, 200) ?? null,
      requestId: meta.requestId ?? null,
    });
    if (action.startsWith('security.')) this.log.warn({ action, actor: actor?.id, ...entity }, 'security event');
  }
}
