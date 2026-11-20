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
export class PasswordRecoveryService {
  constructor(
    private readonly work: UnitOfWork,
    private readonly config: AuthConfig,
    private readonly logger: AppLogger,
    private readonly confirmation: PasswordConfirmation,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(SECURITY_MESSAGES) private readonly messages: SecurityMessages,
  ) {}

  async forgot(email: string): Promise<void> {
    await this.passwords.verify(undefined, newOpaqueToken());
    await this.work.run(async (scope) => {
      const repository = scope.get(RecoveryRepository);
      const candidate = await repository.findUserByEmail(email);
      if (!candidate) return;
      const user = await repository.lockUser(candidate.id);
      const at = new Date();
      if (
        !user ||
        user.status !== 'active' ||
        !user.emailVerifiedAt ||
        (await repository.recentToken('password_reset', user.id, new Date(at.getTime() - 60000)))
      )
        return;
      const token = newOpaqueToken();
      await repository.issueToken(
        'password_reset',
        user.id,
        tokenDigest(token),
        new Date(at.getTime() + this.config.settings.resetTtl * 1000),
        at,
        this.messages.prepare('password_reset', user.email, token),
      );
    });
  }

  async reset(token: string, password: string): Promise<void> {
    const hash = await this.passwords.hash(password);
    const userId = await this.work.run(async (scope) => {
      const repository = scope.get(RecoveryRepository);
      const candidate = await repository.findToken('password_reset', tokenDigest(token));
      if (!candidate) return null;
      const user = await repository.lockUser(candidate.userId);
      const current = await repository.findToken('password_reset', tokenDigest(token));
      const at = new Date();
      if (
        !user ||
        user.status !== 'active' ||
        !user.emailVerifiedAt ||
        !current ||
        current.consumedAt ||
        current.expiresAt <= at
      )
        return null;
      await repository.changeHash(user.id, hash);
      await repository.invalidateRecovery(user.id, at);
      await repository.revokeAll(user.id, at);
      await repository.enqueue(this.messages.prepare('password_changed', user.email));
      return user.id;
    });
    if (!userId) throw new BadRequestException('Reset token is invalid or expired');
    this.logger.security('password.changed', userId);
  }

  async change(principal: Principal, currentPassword: string, newPassword: string): Promise<void> {
    if (currentPassword === newPassword)
      throw new BadRequestException('New password must differ from the current password');
    const proof = await this.confirmation.prepare(principal, currentPassword);
    const hash = await this.passwords.hash(newPassword);
    const accepted = await this.work.run(async (scope) => {
      const repository = scope.get(RecoveryRepository);
      const user = await repository.lockUser(principal.userId);
      if (!(await this.confirmation.accept(repository, principal, user, proof)) || !user)
        return false;
      const at = new Date();
      await repository.changeHash(user.id, hash);
      await repository.invalidateRecovery(user.id, at);
      await repository.revokeAll(user.id, at);
      await repository.enqueue(this.messages.prepare('password_changed', user.email));
      return true;
    });
    if (!accepted) throw new UnauthorizedException('Password confirmation failed');
    this.logger.security('password.changed', principal.userId);
  }
}
