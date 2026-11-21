import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { AuthConfig } from '../../../core/config/auth-config.service';
import { AppLogger } from '../../../core/logging/app-logger.service';
import { AuthenticationRepository } from '../repositories/authentication.repository';
import { PASSWORD_HASHER } from '../interfaces/auth.types';
import type { PasswordHasher, LoginIdentity } from '../interfaces/auth.types';
import { tokenDigest } from '../crypto/opaque-token';
import { failedAttempt } from '../policies/account-lock.policy';
import { loginEligible } from '../policies/login-eligibility';

@Injectable()
export class LocalStrategy {
  constructor(
    private readonly source: DataSource,
    private readonly work: UnitOfWork,
    private readonly config: AuthConfig,
    private readonly logger: AppLogger,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
  ) {}

  async authenticate(email: string, password: string): Promise<LoginIdentity> {
    const candidate = await new AuthenticationRepository(this.source.manager).findCredentials(
      email,
    );
    const matches = await this.passwords.verify(candidate?.passwordHash, password);
    const accepted = candidate
      ? await this.work.run(async (scope) => {
          const repository = scope.get(AuthenticationRepository);
          const user = await repository.lockUser(candidate.id);
          const at = new Date();
          if (!user || (user.lockedUntil && user.lockedUntil > at)) return false;
          if (user.passwordHash !== candidate.passwordHash) return false;
          if (!matches) {
            const state = failedAttempt(user, this.config.settings, at);
            await repository.setLoginState(user.id, state.attempts, state.lockedUntil);
            return false;
          }
          if (!loginEligible(user, at)) return false;
          await repository.setLoginState(user.id, 0, null);
          return true;
        })
      : false;
    // Failure is thrown after commit so lockout counters are never rolled back by the 401.
    if (!accepted || !candidate) {
      this.logger.security('login.failed');
      throw new UnauthorizedException('Invalid credentials or account unavailable');
    }
    return { userId: candidate.id, credentialStamp: tokenDigest(candidate.passwordHash) };
  }
}
