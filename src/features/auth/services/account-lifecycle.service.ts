import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { AuthConfig } from '../../../core/config/auth-config.service';
import { AppLogger } from '../../../core/logging/app-logger.service';
import { PASSWORD_HASHER } from '../interfaces/auth.types';
import type { PasswordHasher, Principal } from '../interfaces/auth.types';
import { SECURITY_MESSAGES } from '../../notifications/interfaces/mail.types';
import type { SecurityMessages } from '../../notifications/interfaces/mail.types';
import { RecoveryRepository } from '../repositories/recovery.repository';
import { newOpaqueToken, tokenDigest } from '../crypto/opaque-token';
import { PasswordConfirmation } from './password-confirmation.service';

@Injectable()
export class AccountLifecycleService {
  constructor(
    private readonly work: UnitOfWork,
    private readonly config: AuthConfig,
    private readonly logger: AppLogger,
    private readonly confirmation: PasswordConfirmation,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(SECURITY_MESSAGES) private readonly messages: SecurityMessages,
  ) {}

  async deactivate(principal: Principal, password: string): Promise<void> {
    const proof = await this.confirmation.prepare(principal, password);
    const accepted = await this.work.run(async (scope) => {
      const repository = scope.get(RecoveryRepository);
      const user = await repository.lockUser(principal.userId);
      if (!(await this.confirmation.accept(repository, principal, user, proof)) || !user)
        return false;
      const at = new Date();
      await repository.setStatus(user.id, 'inactive', 'self');
      await repository.invalidateRecovery(user.id, at);
      await repository.revokeAll(user.id, at);
      await repository.enqueue(this.messages.prepare('account_deactivated', user.email));
      return true;
    });
    if (!accepted) throw new UnauthorizedException('Password confirmation failed');
    this.logger.security('account.deactivated', principal.userId);
  }

  async requestActivation(email: string): Promise<void> {
    await this.passwords.verify(undefined, newOpaqueToken());
    await this.work.run(async (scope) => {
      const repository = scope.get(RecoveryRepository);
      const candidate = await repository.findUserByEmail(email);
      if (!candidate) return;
      const user = await repository.lockUser(candidate.id);
      const at = new Date();
      if (
        !user ||
        user.status !== 'inactive' ||
        user.deactivationSource !== 'self' ||
        !user.emailVerifiedAt ||
        (await repository.recentToken(
          'account_activation',
          user.id,
          new Date(at.getTime() - 60000),
        ))
      )
        return;
      const token = newOpaqueToken();
      await repository.issueToken(
        'account_activation',
        user.id,
        tokenDigest(token),
        new Date(at.getTime() + this.config.settings.activationTtl * 1000),
        at,
        this.messages.prepare('account_activation', user.email, token),
      );
    });
  }

  async activate(token: string): Promise<void> {
    const id = await this.work.run(async (scope) => {
      const repository = scope.get(RecoveryRepository);
      const candidate = await repository.findToken('account_activation', tokenDigest(token));
      if (!candidate) return null;
      const user = await repository.lockUser(candidate.userId);
      const current = await repository.findToken('account_activation', tokenDigest(token));
      const at = new Date();
      if (
        !user ||
        user.status !== 'inactive' ||
        user.deactivationSource !== 'self' ||
        !user.emailVerifiedAt ||
        !current ||
        current.consumedAt ||
        current.expiresAt <= at
      )
        return null;
      await repository.setStatus(user.id, 'active', null);
      await repository.invalidateRecovery(user.id, at);
      await repository.revokeAll(user.id, at);
      await repository.enqueue(this.messages.prepare('account_activated', user.email));
      return user.id;
    });
    if (!id) throw new BadRequestException('Activation token is invalid or expired');
    this.logger.security('account.activated', id);
  }
}
