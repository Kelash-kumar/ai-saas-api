import { Catch, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';
import { AppLogger } from '../../core/logging/app-logger.service';
import { mapDatabaseError } from './database-error';

export interface ApiError {
  success: false;
  statusCode: number;
  message: string;
  errors: string[];
  code?: string;
  timestamp: string;
  path: string;
  requestId?: string;
}

@Catch()
@Injectable()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) { }

  catch(exception: unknown, host: ArgumentsHost): void {
    exception = mapDatabaseError(exception);
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const parserStatus = getParserStatus(exception);
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : (parserStatus ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const requestId = typeof request.id === 'string' ? request.id : undefined;
    let message = STATUS_CODES[status] ?? 'Request failed';
    let errors: string[] = [];
    let code: string | undefined;

    if (status >= 500) {
      message = 'Internal server error';
      this.logger.unexpected(exception, requestId);
    } else if (exception instanceof HttpException) {
      const payload: unknown = exception.getResponse();
      if (typeof payload === 'string') message = payload;
      else if (payload && typeof payload === 'object') {
        if ('message' in payload && typeof payload.message === 'string') message = payload.message;
        if ('message' in payload && Array.isArray(payload.message)) {
          message = 'Validation failed';
          errors = payload.message.filter((value): value is string => typeof value === 'string');
        }
        if ('code' in payload && typeof payload.code === 'string') code = payload.code;
      }
    }
    // Nest's default 404 message includes the original URL, including query tokens.
    if (status === 404) message = 'Resource not found';
    if (response.headersSent) return;
    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      errors,
      code,
      timestamp: new Date().toISOString(),
      // Query strings may carry reset tokens; never echo them in errors.
      path: request.path,
      requestId,
    } satisfies ApiError);
  }
}

/** Express body parser errors are not Nest HttpExceptions. Do not expose their payloads. */
function getParserStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('type' in error)) return undefined;
  if (error.type === 'entity.parse.failed') return HttpStatus.BAD_REQUEST;
  if (error.type === 'entity.too.large') return HttpStatus.PAYLOAD_TOO_LARGE;
  if (error.type === 'encoding.unsupported' || error.type === 'charset.unsupported') {
    return HttpStatus.UNSUPPORTED_MEDIA_TYPE;
  }
  return undefined;
}
