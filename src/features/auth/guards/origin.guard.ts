import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { RuntimeConfig } from '../../../core/config/runtime-config.service';

@Injectable()
export class AuthOriginGuard implements CanActivate {
  constructor(private readonly config: RuntimeConfig) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    const origin = request.headers.origin;
    if (
      !origin ||
      !this.config.security.corsOrigins.includes(origin) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    ) {
      throw new ForbiddenException('Origin is not permitted');
    }
    return true;
  }
}
