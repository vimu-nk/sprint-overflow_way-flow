import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { TransitionError } from '@wayflow/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Consistent error envelope; never leaks stack traces or SQL (SEC-42). */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();
    const requestId = String(req.id);
    let status = 500;
    let body: { code: string; message: string; details?: unknown } = {
      code: 'internal_error',
      message: 'Something went wrong. Try again in a moment.',
    };
    if (exception instanceof ThrottlerException) {
      status = 429;
      body = { code: 'rate_limited', message: 'Too many requests. Wait a moment and try again.' };
    } else if (exception instanceof TransitionError) {
      status = 409;
      body = { code: 'illegal_transition', message: exception.message };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      if (typeof r === 'object' && r && 'code' in r) {
        const o = r as { code: string; message: string; details?: unknown };
        body = { code: o.code, message: o.message, details: o.details };
      } else {
        body = {
          code: status === 404 ? 'not_found' : status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : 'bad_request',
          message: status === 404 ? 'Not found' : exception.message,
        };
      }
    } else if (
      typeof exception === 'object' &&
      exception &&
      'statusCode' in exception &&
      typeof (exception as { statusCode: unknown }).statusCode === 'number' &&
      (exception as { statusCode: number }).statusCode < 500
    ) {
      // Fastify errors (body too large, bad JSON, multipart limits)
      status = (exception as { statusCode: number }).statusCode;
      body = { code: status === 413 ? 'payload_too_large' : 'bad_request', message: status === 413 ? 'The upload is too large.' : 'The request could not be read.' };
    }
    if (status >= 500) this.log.error({ err: exception, requestId }, 'Unhandled error');
    void reply.status(status).header('cache-control', 'no-store').send({ ...body, requestId });
  }
}
