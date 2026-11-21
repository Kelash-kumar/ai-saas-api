import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { AuthConfig } from '../../../core/config/auth-config.service';
import { AppLogger } from '../../../core/logging/app-logger.service';
import { AuthenticationRepository } from '../repositories/authentication.repository';
import { PASSWORD_HASHER, VERIFICATION_MESSAGE } from '../interfaces/auth.types';
import type { PasswordHasher, VerificationMessageFactory } from '../interfaces/auth.types';
import { newOpaqueToken, tokenDigest } from '../crypto/opaque-token';

@Injectable()
export class RegistrationService {
  constructor(
    private readonly work: UnitOfWork,
    private readonly config: AuthConfig,
    private readonly logger: AppLogger,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    @Inject(VERIFICATION_MESSAGE) private readonly messages: VerificationMessageFactory,
  ) {}

  async register(email: string, password: string): Promise<void> {
    // Always perform the expensive work, including when the email already exists.
    const hash = await this.passwords.hash(password);
    const id = await this.work.run(async (scope) => {
      const repository = scope.get(AuthenticationRepository);
      return this.provision(repository, email, hash);
    });
    if (id) this.logger.security('account.registered', id);
  }

  /** Shared account provisioning; the caller owns the transaction and authorization boundary. */
  async provision(
    repository: AuthenticationRepository,
    email: string,
    hash: string,
  ): Promise<string | null> {
    const userId = await repository.insertUser(email, hash);
    if (!userId) return null;
    const token = newOpaqueToken();
    await repository.queueVerification(
      userId,
      tokenDigest(token),
      new Date(Date.now() + this.config.settings.verificationTtl * 1000),
      this.messages.prepare(email, token),
    );
    return userId;
  }

  async provisionManaged(
    repository: AuthenticationRepository,
    email: string,
    hash: string,
    approvedBy: string,
  ): Promise<string | null> {
    const id = await this.provision(repository, email, hash);
    if (id) await repository.approveManagedAccess(id, approvedBy, new Date());
    return id;
  }

  async requestVerification(email: string): Promise<void> {
    await this.passwords.verify(undefined, newOpaqueToken());
    await this.work.run(async (scope) => {
      const repository = scope.get(AuthenticationRepository);
      const candidate = await repository.findUserByEmail(email);
      if (!candidate) return;
      const user = await repository.lockUser(candidate.id);
      if (
        !user ||
        user.emailVerifiedAt ||
        user.status !== 'active' ||
        (await repository.recentVerification(user.id, new Date(Date.now() - 60000)))
      )
        return;
      const token = newOpaqueToken();
      await repository.queueVerification(
        user.id,
        tokenDigest(token),
        new Date(Date.now() + this.config.settings.verificationTtl * 1000),
        this.messages.prepare(email, token),
      );
    });
  }

  async verify(token: string): Promise<void> {
    const valid = await this.work.run(async (scope) => {
      const repository = scope.get(AuthenticationRepository);
      const candidate = await repository.findVerification(tokenDigest(token));
      if (!candidate) return false;
      const user = await repository.lockUser(candidate.userId);
      const current = await repository.findVerification(tokenDigest(token));
      const at = new Date();
      if (
        !user ||
        user.status !== 'active' ||
        user.emailVerifiedAt ||
        !current ||
        current.consumedAt ||
        current.expiresAt <= at
      )
        return false;
      await repository.markVerified(user.id, current.id, at);
      return true;
    });
    if (!valid) throw new BadRequestException('Verification token is invalid or expired');
  }
}
