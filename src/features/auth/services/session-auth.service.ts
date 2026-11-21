import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { AuthConfig } from '../../../core/config/auth-config.service';
import { AppLogger } from '../../../core/logging/app-logger.service';
import { AuthenticationRepository } from '../repositories/authentication.repository';
import { AccessTokenService } from '../crypto/access-token.service';
import { SessionCookies } from '../transport/session-cookies';
import { newOpaqueToken, tokenDigest } from '../crypto/opaque-token';
import type {
  ClientDevice,
  IssuedCredentials,
  Principal,
  LoginIdentity,
} from '../interfaces/auth.types';
import type { UserEntity } from '../../users/entities/user.entity';
import type { SessionEntity } from '../../sessions/entities/session.entity';
import type { PageQueryDto } from '../../../common/pagination/page-query.dto';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';

function eligible(user: UserEntity | null, at: Date): user is UserEntity {
  return (
    !!user &&
    user.status === 'active' &&
    !!user.emailVerifiedAt &&
    (!user.lockedUntil || user.lockedUntil <= at)
  );
}

@Injectable()
export class SessionAuthService {
  constructor(
    private readonly source: DataSource,
    private readonly work: UnitOfWork,
    private readonly config: AuthConfig,
    private readonly access: AccessTokenService,
    private readonly cookies: SessionCookies,
    private readonly logger: AppLogger,
  ) {}

  private async issue(
    userId: string,
    session: SessionEntity,
    refreshToken: string,
  ): Promise<IssuedCredentials> {
    const expiresIn = Math.min(
      this.config.settings.accessTtl,
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
    );
    if (expiresIn < 1) throw new UnauthorizedException('Session expired');
    return {
      accessToken: await this.access.sign(userId, session.id, expiresIn),
      refreshToken,
      csrfToken: this.cookies.csrf(refreshToken),
      expiresIn,
      sessionId: session.id,
      sessionExpiresAt: session.expiresAt,
    };
  }

  async login(
    identity: LoginIdentity,
    device: ClientDevice,
    adminPortal = false,
  ): Promise<IssuedCredentials> {
    const { userId } = identity;
    const credentials = await this.work.run(async (scope) => {
      const repository = scope.get(AuthenticationRepository);
      const policy = scope.get(AuthorizationRepository);
      if (adminPortal) await policy.lockPolicy();
      const user = await repository.lockUser(userId);
      if (
        !eligible(user, new Date()) ||
        tokenDigest(user.passwordHash) !== identity.credentialStamp
      )
        return null;
      if (adminPortal && !(await policy.userAuthority(userId)).permissions.includes('admin.access'))
        return null;
      const session = await repository.createSession(
        userId,
        new Date(Date.now() + this.config.settings.refreshTtl * 1000),
        device,
      );
      const token = newOpaqueToken();
      await repository.insertRefresh(session.id, tokenDigest(token), session.expiresAt, null);
      return this.issue(userId, session, token);
    });
    if (!credentials) throw new UnauthorizedException('Invalid credentials or account unavailable');
    this.logger.security('login.succeeded', userId);
    return credentials;
  }

  async refresh(raw: string): Promise<IssuedCredentials> {
    const result = await this.work.run(async (scope) => {
      const repository = scope.get(AuthenticationRepository);
      const candidate = await repository.findRefresh(tokenDigest(raw));
      if (!candidate) return null;
      const owner = await repository.findSession(candidate.sessionId);
      if (!owner) return null;
      // All auth mutations acquire user, then session. This order also covers logout and future password reset.
      const user = await repository.lockUser(owner.userId);
      const session = await repository.lockSession(owner.id, owner.userId);
      const current = await repository.findRefresh(tokenDigest(raw));
      const at = new Date();
      if (!session || !current || session.revokedAt || session.expiresAt <= at) return null;
      if (current.consumedAt || current.revokedAt || !eligible(user, at)) {
        await repository.revokeSession(session.id, at);
        return null;
      }
      if (current.expiresAt <= at) return null;
      const next = newOpaqueToken();
      await repository.consumeRefresh(current.id, session.id, at);
      await repository.insertRefresh(session.id, tokenDigest(next), session.expiresAt, current.id);
      return this.issue(session.userId, session, next);
    });
    // Replay revocation must commit, so authentication failure is outside the transaction callback.
    if (!result) {
      this.logger.security('refresh.rejected');
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }
    return result;
  }

  async logout(raw: string): Promise<void> {
    await this.work.run(async (scope) => {
      const repository = scope.get(AuthenticationRepository);
      const token = await repository.findRefresh(tokenDigest(raw));
      if (!token) return;
      const owner = await repository.findSession(token.sessionId);
      if (!owner) return;
      await repository.lockUser(owner.userId);
      if (await repository.lockSession(owner.id, owner.userId))
        await repository.revokeSession(owner.id, new Date());
    });
    this.logger.security('session.revoked');
  }

  async revoke(principal: Principal, sessionId?: string): Promise<void> {
    const found = await this.work.run(async (scope) => {
      const repository = scope.get(AuthenticationRepository);
      const user = await repository.lockUser(principal.userId);
      if (!eligible(user, new Date())) return false;
      const actor = await repository.lockSession(principal.sessionId, principal.userId);
      if (!actor || actor.revokedAt || actor.expiresAt <= new Date()) return false;
      if (sessionId) {
        if (!(await repository.lockSession(sessionId, principal.userId))) return false;
        await repository.revokeSession(sessionId, new Date());
      } else {
        await repository.revokeAll(principal.userId, new Date());
      }
      return true;
    });
    if (!found) throw new NotFoundException('Session not found');
    this.logger.security('session.revoked', principal.userId);
  }

  list(principal: Principal, query: PageQueryDto) {
    return new AuthenticationRepository(this.source.manager).listSessions(principal.userId, query);
  }
}
