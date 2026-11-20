import { Injectable, StreamableFile } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { map } from 'rxjs';
import { RAW_RESPONSE } from './response.decorator';

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor<unknown, unknown> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [
      context.getHandler(),
      context.getClass(),
    ]);
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((data: unknown) => {
        if (raw || response.statusCode === 204 || data instanceof StreamableFile) return data;
        return { success: true, data } satisfies ApiSuccess<unknown>;
      }),
    );
  }
}
