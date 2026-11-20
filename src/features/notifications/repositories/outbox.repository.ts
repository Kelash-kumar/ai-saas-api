import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MailConfig } from '../../../core/config/mail-config.service';
import { MailOutboxEntity } from '../entities/mail-outbox.entity';
import { EmailVerificationTokenEntity } from '../../auth/entities/email-verification-token.entity';
import { PasswordResetTokenEntity } from '../../auth/entities/password-reset-token.entity';
import { AccountActivationTokenEntity } from '../../auth/entities/account-activation-token.entity';

@Injectable()
export class OutboxRepository {
  constructor(
    private readonly source: DataSource,
    private readonly config: MailConfig,
  ) {}
  claim(): Promise<MailOutboxEntity | null> {
    return this.source.transaction(async (manager) => {
      const repository = manager.getRepository(MailOutboxEntity);
      await repository
        .createQueryBuilder()
        .update()
        .set({
          deadAt: () => 'CURRENT_TIMESTAMP',
          lastErrorCode: 'ATTEMPTS_EXHAUSTED',
          leaseId: null,
          leasedUntil: null,
        })
        .where('processed_at IS NULL AND dead_at IS NULL AND attempts >= :max', {
          max: this.config.settings.maxAttempts,
        })
        .andWhere('(leased_until IS NULL OR leased_until <= CURRENT_TIMESTAMP)')
        .execute();
      const mail = await repository
        .createQueryBuilder('mail')
        .addSelect(['mail.recipient', 'mail.payloadCiphertext'])
        .where(
          'mail.processedAt IS NULL AND mail.deadAt IS NULL AND mail.availableAt <= CURRENT_TIMESTAMP',
        )
        .andWhere('(mail.leasedUntil IS NULL OR mail.leasedUntil <= CURRENT_TIMESTAMP)')
        .andWhere('mail.attempts < :max', { max: this.config.settings.maxAttempts })
        .orderBy('mail.availableAt', 'ASC')
        .addOrderBy('mail.id', 'ASC')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getOne();
      if (!mail) return null;
      mail.leaseId = randomUUID();
      mail.attempts++;
      await repository
        .createQueryBuilder()
        .update()
        .set({
          leaseId: mail.leaseId,
          attempts: () => 'attempts + 1',
          leasedUntil: () => "CURRENT_TIMESTAMP + (:lease * interval '1 millisecond')",
        })
        .where('id = :id', { id: mail.id })
        .setParameter('lease', this.config.settings.leaseMs)
        .execute();
      return mail;
    });
  }
  async complete(mail: MailOutboxEntity, code: string | null = null): Promise<void> {
    await this.source
      .getRepository(MailOutboxEntity)
      .createQueryBuilder()
      .update()
      .set({
        processedAt: () => 'CURRENT_TIMESTAMP',
        lastErrorCode: code,
        leaseId: null,
        leasedUntil: null,
      })
      .where('id = :id AND lease_id = :lease', { id: mail.id, lease: mail.leaseId })
      .execute();
  }
  ownsLease(mail: MailOutboxEntity): Promise<boolean> {
    return this.source
      .getRepository(MailOutboxEntity)
      .createQueryBuilder('mail')
      .where('mail.id = :id AND mail.leaseId = :lease', { id: mail.id, lease: mail.leaseId })
      .andWhere('mail.leasedUntil > CURRENT_TIMESTAMP')
      .getExists();
  }
  async failed(
    mail: MailOutboxEntity,
    code: string,
    permanent: boolean,
    delayMs: number,
  ): Promise<void> {
    const dead = permanent || mail.attempts >= this.config.settings.maxAttempts;
    await this.source
      .getRepository(MailOutboxEntity)
      .createQueryBuilder()
      .update()
      .set({
        deadAt: dead ? () => 'CURRENT_TIMESTAMP' : null,
        lastErrorCode: code,
        leaseId: null,
        leasedUntil: null,
        availableAt: () => "CURRENT_TIMESTAMP + (:delay * interval '1 millisecond')",
      })
      .where('id = :id AND lease_id = :lease', { id: mail.id, lease: mail.leaseId })
      .setParameter('delay', delayMs)
      .execute();
  }
  async tokenIsCurrent(template: string, recipient: string, digest: string): Promise<boolean> {
    const target =
      template === 'verify_email'
        ? EmailVerificationTokenEntity
        : template === 'password_reset'
          ? PasswordResetTokenEntity
          : template === 'account_activation'
            ? AccountActivationTokenEntity
            : null;
    if (!target) return false;
    const builder = this.source
      .getRepository<PasswordResetTokenEntity>(target)
      .createQueryBuilder('token')
      .innerJoin('token.user', 'user')
      .where('token.tokenDigest = :digest AND user.email = :recipient', { digest, recipient })
      .andWhere('token.consumedAt IS NULL AND token.expiresAt > CURRENT_TIMESTAMP');
    if (template === 'account_activation')
      builder.andWhere(
        "user.status = 'inactive' AND user.deactivationSource = 'self' AND user.emailVerifiedAt IS NOT NULL",
      );
    else
      builder
        .andWhere("user.status = 'active'")
        .andWhere(
          template === 'verify_email'
            ? 'user.emailVerifiedAt IS NULL'
            : 'user.emailVerifiedAt IS NOT NULL',
        );
    return builder.getExists();
  }
}
