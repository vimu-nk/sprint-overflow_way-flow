import { HttpException, HttpStatus } from '@nestjs/common';

/** Domain error with a stable machine code; rendered as {code, message, details, requestId}. */
export class AppError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what = 'Not found') => new AppError('not_found', what, HttpStatus.NOT_FOUND);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(code, message, HttpStatus.CONFLICT, details);
export const forbidden = (message = 'You do not have access to this.') =>
  new AppError('forbidden', message, HttpStatus.FORBIDDEN);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
