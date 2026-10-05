import { Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { meta } from '../auth/auth.controller.js';
import { CurrentUser, type SessionUser } from '../common/decorators.js';
import { AppError } from '../common/errors.js';
import { parse } from '../common/zod.js';
import { AttachmentsService } from './attachments.service.js';
import { MAX_UPLOAD_BYTES } from './image.js';

const fields = z
  .object({ entityType: z.enum(['stop', 'flag', 'receipt']), entityId: z.string().uuid(), clientAttachmentId: z.string().uuid() })
  .strict();

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly svc: AttachmentsService) {}

  /** Multipart upload: fields first, then `file`. 20 uploads/min per user (SEC-50). */
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async upload(@CurrentUser() user: SessionUser, @Req() req: FastifyRequest) {
    if (!req.isMultipart()) throw new AppError('bad_request', 'Expected a multipart upload.', HttpStatus.BAD_REQUEST);
    const values: Record<string, string> = {};
    let data: Buffer | null = null;
    for await (const part of req.parts({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, fieldSize: 200 } })) {
      if (part.type === 'file') {
        data = await part.toBuffer();
        if (part.file.truncated) throw new AppError('payload_too_large', 'Photos must be 5 MB or smaller.', HttpStatus.PAYLOAD_TOO_LARGE);
      } else {
        values[part.fieldname] = String(part.value);
      }
    }
    if (!data) throw new AppError('bad_request', 'No file in the upload.', HttpStatus.BAD_REQUEST);
    const f = parse(fields, values);
    return this.svc.upload(user, { ...f, data }, meta(req));
  }

  /** Authorised, proxied read; private bucket, no public URLs (SEC-38). */
  @Get(':id/content')
  async content(@CurrentUser() user: SessionUser, @Param('id', ParseUUIDPipe) id: string, @Res() reply: FastifyReply) {
    const file = await this.svc.read(user, id);
    return reply
      .header('content-type', file.contentType)
      .header('content-length', String(file.size))
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=300')
      .header('content-disposition', 'inline; filename="photo.jpg"')
      .send(file.body);
  }
}
