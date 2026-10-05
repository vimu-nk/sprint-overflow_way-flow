import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AttachmentPurpose } from '@wayflow/shared';
import { and, eq } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { AuditService, type AuditMeta } from '../audit/audit.service.js';
import type { SessionUser } from '../common/decorators.js';
import { AppError, notFound } from '../common/errors.js';
import { DB, type Db } from '../db/drizzle.module.js';
import { attachments, loadFlags, orders, plans, stops, trips } from '../db/schema.js';
import { BUCKET, S3 } from '../storage/storage.module.js';
import { MAX_UPLOAD_BYTES, reencode, sniffImage } from './image.js';

const ENTITY_PURPOSE: Record<string, AttachmentPurpose> = { stop: 'pod', flag: 'flag', receipt: 'receipt' };

/** Private object storage for photos (specs/11). The DB row is the source of truth. */
@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(S3) private readonly s3: S3Client,
    private readonly audit: AuditService,
  ) {}

  /** Who may attach a photo to an entity, checked against the session (SEC-26). Returns the key prefix. */
  private async authorizeWrite(user: SessionUser, entityType: string, entityId: string): Promise<string> {
    const ym = new Date().toISOString().slice(0, 7).replace('-', '/');
    if (entityType === 'stop' && user.role === 'driver') {
      const [r] = await this.db.select({ tripId: stops.tripId }).from(stops).innerJoin(trips, eq(trips.id, stops.tripId)).where(and(eq(stops.id, entityId), eq(trips.vehicleId, user.vehicleId ?? '')));
      if (r) return `pod/${ym}/${r.tripId}/${entityId}`;
    }
    if (entityType === 'flag' && user.role === 'loader' && user.depot) {
      const [r] = await this.db.select({ tripId: loadFlags.tripId }).from(loadFlags).innerJoin(trips, eq(trips.id, loadFlags.tripId)).innerJoin(plans, eq(plans.id, trips.planId)).where(and(eq(loadFlags.id, entityId), eq(plans.depot, user.depot)));
      if (r) return `flags/${ym}/${r.tripId}/${entityId}`;
    }
    if (entityType === 'receipt' && user.role === 'store_manager') {
      const [r] = await this.db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, entityId), eq(orders.outletId, user.outletId ?? '')));
      if (r) return `receipts/${ym}/${entityId}`;
    }
    throw notFound('Item not found');
  }

  async upload(user: SessionUser, input: { entityType: string; entityId: string; clientAttachmentId: string; data: Buffer }, meta: AuditMeta) {
    const purpose = ENTITY_PURPOSE[input.entityType];
    if (!purpose) throw new AppError('bad_entity', 'Unknown attachment target.', HttpStatus.BAD_REQUEST);
    const [existing] = await this.db.select().from(attachments).where(and(eq(attachments.uploadedBy, user.id), eq(attachments.clientAttachmentId, input.clientAttachmentId)));
    if (existing) return { id: existing.id, url: `/api/v1/attachments/${existing.id}/content` };
    const prefix = await this.authorizeWrite(user, input.entityType, input.entityId);
    if (input.data.length > MAX_UPLOAD_BYTES) throw new AppError('payload_too_large', 'Photos must be 5 MB or smaller.', HttpStatus.PAYLOAD_TOO_LARGE);
    if (!sniffImage(input.data)) throw new AppError('unsupported_type', 'Only JPEG, PNG or WebP photos are accepted.', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    let clean: Buffer;
    try {
      clean = await reencode(input.data);
    } catch {
      throw new AppError('unsupported_type', 'The photo could not be read.', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    // Server-generated key: no user-controlled path or file name.
    const key = `${prefix}/${crypto.randomUUID()}.jpg`;
    await this.s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: clean, ContentType: 'image/jpeg' }));
    const [row] = await this.db
      .insert(attachments)
      .values({ objectKey: key, contentType: 'image/jpeg', sizeBytes: clean.length, purpose, entityType: input.entityType, entityId: input.entityId, uploadedBy: user.id, clientAttachmentId: input.clientAttachmentId })
      .onConflictDoNothing()
      .returning({ id: attachments.id });
    const id = row?.id ?? (await this.db.select().from(attachments).where(and(eq(attachments.uploadedBy, user.id), eq(attachments.clientAttachmentId, input.clientAttachmentId))))[0]!.id;
    await this.audit.record(user, 'attachment.upload', { type: input.entityType, id: input.entityId }, { attachmentId: id, bytes: clean.length }, meta);
    return { id, url: `/api/v1/attachments/${id}/content` };
  }

  /** Read check: dispatcher sees all; others only photos tied to their own scope. */
  async read(user: SessionUser, id: string): Promise<{ body: Readable; contentType: string; size: number }> {
    const [a] = await this.db.select().from(attachments).where(eq(attachments.id, id));
    if (!a || !(await this.canRead(user, a))) throw notFound('Photo not found');
    const res = await this.s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: a.objectKey }));
    return { body: res.Body as Readable, contentType: a.contentType, size: a.sizeBytes };
  }

  private async canRead(user: SessionUser, a: typeof attachments.$inferSelect): Promise<boolean> {
    if (user.role === 'dispatcher' || a.uploadedBy === user.id) return true;
    if (a.entityType === 'stop') {
      const [r] = await this.db.select({ vehicleId: trips.vehicleId, depot: plans.depot, outletId: orders.outletId }).from(stops).innerJoin(trips, eq(trips.id, stops.tripId)).innerJoin(plans, eq(plans.id, trips.planId)).innerJoin(orders, eq(orders.id, stops.orderId)).where(eq(stops.id, a.entityId));
      if (!r) return false;
      return (user.role === 'driver' && r.vehicleId === user.vehicleId) || (user.role === 'store_manager' && r.outletId === user.outletId) || (user.role === 'loader' && r.depot === user.depot);
    }
    if (a.entityType === 'flag') {
      const [r] = await this.db.select({ vehicleId: trips.vehicleId, depot: plans.depot }).from(loadFlags).innerJoin(trips, eq(trips.id, loadFlags.tripId)).innerJoin(plans, eq(plans.id, trips.planId)).where(eq(loadFlags.id, a.entityId));
      if (!r) return false;
      return (user.role === 'loader' && r.depot === user.depot) || (user.role === 'driver' && r.vehicleId === user.vehicleId);
    }
    if (a.entityType === 'receipt') {
      const [r] = await this.db.select({ outletId: orders.outletId }).from(orders).where(eq(orders.id, a.entityId));
      return user.role === 'store_manager' && r?.outletId === user.outletId;
    }
    return false;
  }
}
