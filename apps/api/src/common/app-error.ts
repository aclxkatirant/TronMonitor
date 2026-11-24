import { HttpException, HttpStatus } from '@nestjs/common';
import { MESSAGES, type MessageCode } from './messages';

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Tutarlı hata gövdesi üreten uygulama hatası. Tüm istemciye dönen hatalar bu biçimdedir.
 */
export class AppError extends HttpException {
  constructor(code: MessageCode, status: HttpStatus, details?: unknown) {
    const body: ErrorBody = { statusCode: status, code, message: MESSAGES[code] };
    if (details !== undefined) body.details = details;
    super(body, status);
  }

  static unauthorized(code: MessageCode = 'AUTH_UNAUTHENTICATED'): AppError {
    return new AppError(code, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(code: MessageCode = 'AUTH_FORBIDDEN'): AppError {
    return new AppError(code, HttpStatus.FORBIDDEN);
  }

  static notFound(code: MessageCode = 'NOT_FOUND'): AppError {
    return new AppError(code, HttpStatus.NOT_FOUND);
  }

  static badRequest(code: MessageCode, details?: unknown): AppError {
    return new AppError(code, HttpStatus.BAD_REQUEST, details);
  }

  static conflict(code: MessageCode): AppError {
    return new AppError(code, HttpStatus.CONFLICT);
  }
}
