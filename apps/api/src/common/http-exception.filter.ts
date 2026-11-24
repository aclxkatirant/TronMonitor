import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import { MESSAGES } from './messages';
import type { ErrorBody } from './app-error';

/**
 * Tüm hataları tutarlı ve Türkçe bir gövdeye dönüştürür. İç hata ayrıntıları istemciye sızdırılmaz.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(`${request.method} ${request.url} -> ${body.statusCode}: ${err.message}`, err.stack);
    }
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof ThrottlerException) {
      return {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'AUTH_RATE_LIMITED',
        message: MESSAGES.AUTH_RATE_LIMITED,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus() as HttpStatus;
      const raw = exception.getResponse();

      if (typeof raw === 'object' && raw !== null && 'code' in raw && 'message' in raw) {
        return raw as ErrorBody;
      }

      // class-validator doğrulama hataları: { message: string[] }
      if (status === HttpStatus.BAD_REQUEST && typeof raw === 'object' && raw !== null) {
        const rawMessage = (raw as { message?: unknown }).message;
        return {
          statusCode: status,
          code: 'VALIDATION_FAILED',
          message: MESSAGES.VALIDATION_FAILED,
          details: Array.isArray(rawMessage) ? rawMessage : undefined,
        };
      }

      if (status === HttpStatus.NOT_FOUND) {
        return { statusCode: status, code: 'NOT_FOUND', message: MESSAGES.NOT_FOUND };
      }
      if (status === HttpStatus.UNAUTHORIZED) {
        return { statusCode: status, code: 'AUTH_UNAUTHENTICATED', message: MESSAGES.AUTH_UNAUTHENTICATED };
      }
      if (status === HttpStatus.FORBIDDEN) {
        return { statusCode: status, code: 'AUTH_FORBIDDEN', message: MESSAGES.AUTH_FORBIDDEN };
      }

      return {
        statusCode: status,
        code: 'HTTP_ERROR',
        message: typeof raw === 'string' ? raw : MESSAGES.INTERNAL_ERROR,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: MESSAGES.INTERNAL_ERROR,
    };
  }
}
