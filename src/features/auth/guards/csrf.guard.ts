import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { SessionCookies } from '../transport/session-cookies';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly cookies: SessionCookies) {}
  canActivate(context: ExecutionContext): boolean {
    this.cookies.checkCsrf(context.switchToHttp().getRequest<Request>());
    return true;
  }
}
