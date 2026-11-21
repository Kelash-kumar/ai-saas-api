import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthConfig } from '../../../core/config/auth-config.service';
import { PASSWORD_HASHER } from '../interfaces/auth.types';
import type { PasswordHasher, Principal } from '../interfaces/auth.types';
import type { UserEntity } from '../../users/entities/user.entity';
import { RecoveryRepository } from '../repositories/recovery.repository';
import { failedAttempt } from '../policies/account-lock.policy';
import { loginEligible } from '../policies/login-eligibility';

export interface PasswordProof {
  hash: string | undefined;
  matches: boolean;
}

@Injectable()
export class PasswordConfirmation {
  constructor(
    private readonly source: DataSource,
    private readonly config: AuthConfig,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
  ) {}
  async prepare(principal: Principal, password: string): Promise<PasswordProof> {
    const candidate = await new RecoveryRepository(this.source.manager).findCredentials(
      principal.email,
    );
    const hash = candidate?.id === principal.userId ? candidate.passwordHash : undefined;
    return { hash, matches: await this.hasher.verify(hash, password) };
  }
  async accept(
    repository: RecoveryRepository,
    principal: Principal,
    user: UserEntity | null,
    proof: PasswordProof,
  ): Promise<boolean> {
    const at = new Date();
    if (!loginEligible(user, at)) return false;
    const session = await repository.lockSession(principal.sessionId, user.id);
    if (!session || session.revokedAt || session.expiresAt <= at) return false;
    if (proof.hash !== user.passwordHash) return false;
    if (!proof.matches) {
      const state = failedAttempt(user, this.config.settings, at);
      await repository.setLoginState(user.id, state.attempts, state.lockedUntil);
      return false;
    }
    return true;
  }
}
