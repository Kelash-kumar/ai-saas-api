import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { AuthConfig } from '../../../core/config/auth-config.service';

const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AuthConfig,
  ) {}

  sign(userId: string, sessionId: string, lifetime: number): Promise<string> {
    const settings = this.config.settings;
    return this.jwt.signAsync(
      { sid: sessionId, tokenUse: 'access' },
      {
        secret: settings.jwtKey,
        algorithm: 'HS256',
        subject: userId,
        jwtid: randomUUID(),
        expiresIn: lifetime,
        issuer: settings.issuer,
        audience: settings.audience,
      },
    );
  }

  async verify(token: string): Promise<{ userId: string; sessionId: string }> {
    try {
      if (token.length > 4096) throw new Error('Invalid token');
      const payload: unknown = await this.jwt.verifyAsync(token, {
        secret: this.config.settings.jwtKey,
        algorithms: ['HS256'],
        issuer: this.config.settings.issuer,
        audience: this.config.settings.audience,
        clockTolerance: 0,
      });
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('sub' in payload) ||
        !uuid(payload.sub) ||
        !('sid' in payload) ||
        !uuid(payload.sid) ||
        !('jti' in payload) ||
        !uuid(payload.jti) ||
        !('tokenUse' in payload) ||
        payload.tokenUse !== 'access' ||
        !('exp' in payload) ||
        typeof payload.exp !== 'number' ||
        !('iat' in payload) ||
        typeof payload.iat !== 'number' ||
        payload.iat > Math.floor(Date.now() / 1000) + 5
      )
        throw new Error('Invalid claims');
      return { userId: payload.sub, sessionId: payload.sid };
    } catch {
      throw new UnauthorizedException('Authentication required');
    }
  }
}
