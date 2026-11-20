import { Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccessTokenService } from '../crypto/access-token.service';
import { AuthenticationRepository } from '../repositories/authentication.repository';
import type { Principal } from '../interfaces/auth.types';

@Injectable()
export class JwtStrategy {
  constructor(
    private readonly source: DataSource,
    private readonly tokens: AccessTokenService,
  ) {}
  async authenticate(token: string): Promise<Principal> {
    const claims = await this.tokens.verify(token);
    const principal = await new AuthenticationRepository(this.source.manager).principal(
      claims.userId,
      claims.sessionId,
      new Date(),
    );
    if (!principal) throw new UnauthorizedException('Authentication required');
    return principal;
  }
}
