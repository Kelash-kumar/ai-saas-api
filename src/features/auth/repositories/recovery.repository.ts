import { IsNull, MoreThan } from 'typeorm';
import type { Repository } from 'typeorm';
import { AuthenticationRepository } from './authentication.repository';
import { PasswordResetTokenEntity } from '../entities/password-reset-token.entity';
import { AccountActivationTokenEntity } from '../entities/account-activation-token.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { MailOutboxEntity } from '../../notifications/entities/mail-outbox.entity';
import type { PreparedVerification } from '../interfaces/auth.types';
import type { RecoveryPurpose } from '../../notifications/interfaces/mail.types';

export class RecoveryRepository extends AuthenticationRepository {
  private tokens(purpose: RecoveryPurpose): Repository<PasswordResetTokenEntity> {
    return this.manager.getRepository<PasswordResetTokenEntity>(
      purpose === 'password_reset' ? PasswordResetTokenEntity : AccountActivationTokenEntity,
    );
  }
  findToken(purpose: RecoveryPurpose, digest: string) {
    return this.tokens(purpose).findOneBy({ tokenDigest: digest });
  }
  recentToken(purpose: RecoveryPurpose, userId: string, since: Date) {
    return this.tokens(purpose).existsBy({ userId, createdAt: MoreThan(since) });
  }
  async issueToken(
    purpose: RecoveryPurpose,
    userId: string,
    digest: string,
    expiry: Date,
    at: Date,
    message: PreparedVerification,
  ): Promise<void> {
    await this.tokens(purpose).update({ userId, consumedAt: IsNull() }, { consumedAt: at });
    await this.tokens(purpose).insert({ userId, tokenDigest: digest, expiresAt: expiry });
    await this.enqueue(message);
  }
  async enqueue(message: PreparedVerification): Promise<void> {
    await this.manager.getRepository(MailOutboxEntity).insert(message);
  }
  async invalidateRecovery(userId: string, at: Date): Promise<void> {
    for (const purpose of ['password_reset', 'account_activation'] as const)
      await this.tokens(purpose).update({ userId, consumedAt: IsNull() }, { consumedAt: at });
  }
  async changeHash(userId: string, hash: string): Promise<void> {
    await this.manager
      .getRepository(UserEntity)
      .update({ id: userId }, { passwordHash: hash, failedLoginAttempts: 0, lockedUntil: null });
  }
  async setStatus(
    userId: string,
    status: 'active' | 'inactive',
    source: 'self' | 'administrative' | null,
  ): Promise<void> {
    await this.manager
      .getRepository(UserEntity)
      .update(
        { id: userId },
        { status, deactivationSource: source, failedLoginAttempts: 0, lockedUntil: null },
      );
  }
}
