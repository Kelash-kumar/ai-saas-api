import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { parse } from 'cookie';
import type { Request, Response, CookieOptions } from 'express';
import { AuthConfig } from '../../../core/config/auth-config.service';
import { validOpaqueToken } from '../crypto/opaque-token';
import type { IssuedCredentials } from '../interfaces/auth.types';

@Injectable()
export class SessionCookies {
  constructor(private readonly config: AuthConfig) {}
  get name(): string {
    return this.config.settings.secureCookie ? '__Host-foundation_refresh' : 'foundation_refresh';
  }
  private get options(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.settings.secureCookie,
      sameSite: 'strict',
      path: '/',
    };
  }

  read(request: Pick<Request, 'headers'>): string {
    const token = parse(request.headers.cookie ?? '')[this.name];
    if (!validOpaqueToken(token))
      throw new UnauthorizedException('Refresh token is invalid or expired');
    return token;
  }

  csrf(refresh: string): string {
    return createHmac('sha256', this.config.settings.csrfKey).update(refresh).digest('base64url');
  }

  checkCsrf(request: Pick<Request, 'headers'>): void {
    const expected = this.csrf(this.read(request));
    const header = request.headers['x-csrf-token'];
    if (!validOpaqueToken(header) || !timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
      throw new ForbiddenException('CSRF validation failed');
    }
  }

  write(response: Response, credentials: IssuedCredentials): CredentialsDtoShape {
    response.cookie(this.name, credentials.refreshToken, {
      ...this.options,
      maxAge: Math.max(0, credentials.sessionExpiresAt.getTime() - Date.now()),
    });
    return {
      accessToken: credentials.accessToken,
      csrfToken: credentials.csrfToken,
      expiresIn: credentials.expiresIn,
      sessionId: credentials.sessionId,
    };
  }
  clear(response: Response): void {
    response.clearCookie(this.name, this.options);
  }
}
export interface CredentialsDtoShape {
  accessToken: string;
  csrfToken: string;
  expiresIn: number;
  sessionId: string;
}
