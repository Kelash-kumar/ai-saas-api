import { IsNull, MoreThan } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { SessionEntity } from '../../sessions/entities/session.entity';
import { RefreshTokenEntity } from '../../sessions/entities/refresh-token.entity';
import { EmailVerificationTokenEntity } from '../entities/email-verification-token.entity';
import { MailOutboxEntity } from '../../notifications/entities/mail-outbox.entity';
import type { PreparedVerification, Principal } from '../interfaces/auth.types';
import type { PageQueryDto } from '../../../common/pagination/page-query.dto';
import { createPage, pageOffset, resolveSort } from '../../../common/pagination/page';

/** Auth-specific database operations. Every mutating workflow receives a scoped manager. */
export class AuthenticationRepository {
  constructor(protected readonly manager: EntityManager) {}

  findCredentials(email: string): Promise<UserEntity | null> {
    return this.manager
      .getRepository(UserEntity)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  lockUser(id: string): Promise<UserEntity | null> {
    return this.manager
      .getRepository(UserEntity)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  findUserByEmail(email: string): Promise<UserEntity | null> {
    return this.manager.getRepository(UserEntity).findOneBy({ email });
  }

  async insertUser(email: string, passwordHash: string): Promise<string | null> {
    const result = await this.manager
      .getRepository(UserEntity)
      .createQueryBuilder()
      .insert()
      .values({ email, passwordHash, userType: 'customer' })
      .orIgnore()
      .returning('id')
      .execute();
    const id: unknown = result.identifiers[0]?.['id'];
    return typeof id === 'string' ? id : null;
  }

  async setLoginState(id: string, attempts: number, lockedUntil: Date | null): Promise<void> {
    await this.manager
      .getRepository(UserEntity)
      .update({ id }, { failedLoginAttempts: attempts, lockedUntil });
  }

  async approveManagedAccess(userId: string, approvedBy: string, at: Date): Promise<void> {
    await this.manager
      .getRepository(UserEntity)
      .update({ id: userId }, { accessApprovedAt: at, accessApprovedBy: approvedBy });
  }

  async verifyMailboxFromLogin(userId: string, at: Date): Promise<void> {
    await this.manager.getRepository(UserEntity).update({ id: userId }, { emailVerifiedAt: at });
    await this.manager
      .getRepository(EmailVerificationTokenEntity)
      .update({ userId, consumedAt: IsNull() }, { consumedAt: at });
  }

  async queueVerification(
    userId: string,
    digest: string,
    expiresAt: Date,
    message: PreparedVerification,
  ): Promise<void> {
    await this.manager
      .getRepository(EmailVerificationTokenEntity)
      .insert({ userId, tokenDigest: digest, expiresAt });
    await this.manager.getRepository(MailOutboxEntity).insert(message);
  }

  async recentVerification(userId: string, since: Date): Promise<boolean> {
    return this.manager
      .getRepository(EmailVerificationTokenEntity)
      .existsBy({ userId, createdAt: MoreThan(since) });
  }

  findVerification(digest: string): Promise<EmailVerificationTokenEntity | null> {
    return this.manager
      .getRepository(EmailVerificationTokenEntity)
      .findOneBy({ tokenDigest: digest });
  }

  async markVerified(userId: string, tokenId: string, at: Date): Promise<void> {
    await this.manager.getRepository(UserEntity).update({ id: userId }, { emailVerifiedAt: at });
    await this.manager
      .getRepository(EmailVerificationTokenEntity)
      .update({ id: tokenId }, { consumedAt: at });
  }

  createSession(
    userId: string,
    expiresAt: Date,
    device: { name?: string; userAgent?: string; ip?: string },
  ): Promise<SessionEntity> {
    return this.manager.getRepository(SessionEntity).save({
      userId,
      expiresAt,
      deviceName: device.name ?? null,
      userAgent: device.userAgent?.slice(0, 512) ?? null,
      ipAddress: device.ip ?? null,
    });
  }

  async insertRefresh(
    sessionId: string,
    digest: string,
    expiresAt: Date,
    parentId: string | null,
  ): Promise<void> {
    await this.manager
      .getRepository(RefreshTokenEntity)
      .insert({ sessionId, tokenDigest: digest, expiresAt, parentId });
  }

  findRefresh(digest: string): Promise<RefreshTokenEntity | null> {
    return this.manager.getRepository(RefreshTokenEntity).findOneBy({ tokenDigest: digest });
  }
  findSession(id: string): Promise<SessionEntity | null> {
    return this.manager.getRepository(SessionEntity).findOneBy({ id });
  }

  lockSession(id: string, userId: string): Promise<SessionEntity | null> {
    return this.manager
      .getRepository(SessionEntity)
      .createQueryBuilder('session')
      .where('session.id = :id AND session.userId = :userId', { id, userId })
      .setLock('pessimistic_write')
      .getOne();
  }

  async consumeRefresh(tokenId: string, sessionId: string, at: Date): Promise<void> {
    await this.manager
      .getRepository(RefreshTokenEntity)
      .update({ id: tokenId, consumedAt: IsNull() }, { consumedAt: at });
    await this.manager.getRepository(SessionEntity).update({ id: sessionId }, { lastSeenAt: at });
  }

  async revokeSession(id: string, at: Date): Promise<void> {
    await this.manager
      .getRepository(SessionEntity)
      .update({ id, revokedAt: IsNull() }, { revokedAt: at });
    await this.manager
      .getRepository(RefreshTokenEntity)
      .update({ sessionId: id, revokedAt: IsNull() }, { revokedAt: at });
  }

  async revokeAll(userId: string, at: Date): Promise<void> {
    await this.manager
      .getRepository(SessionEntity)
      .update({ userId, revokedAt: IsNull() }, { revokedAt: at });
    await this.manager
      .getRepository(RefreshTokenEntity)
      .createQueryBuilder()
      .update()
      .set({ revokedAt: at })
      .where('session_id IN (SELECT id FROM sessions WHERE user_id = :userId)', { userId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  async principal(userId: string, sessionId: string, at: Date): Promise<Principal | null> {
    const session = await this.manager
      .getRepository(SessionEntity)
      .createQueryBuilder('session')
      .innerJoinAndSelect('session.user', 'user')
      .where('session.id = :sessionId AND session.userId = :userId', { userId, sessionId })
      .andWhere('session.revokedAt IS NULL AND session.expiresAt > :at', { at })
      .andWhere(
        "user.status = 'active' AND (user.emailVerifiedAt IS NOT NULL OR user.accessApprovedAt IS NOT NULL)",
      )
      .andWhere('(user.lockedUntil IS NULL OR user.lockedUntil <= :at)', { at })
      .getOne();
    return session
      ? {
          userId,
          sessionId,
          email: session.user.email,
          userType: session.user.userType,
          firstName: session.user.firstName,
          lastName: session.user.lastName,
          avatarData: session.user.avatarData,
        }
      : null;
  }

  async listSessions(userId: string, query: PageQueryDto) {
    if (query.search !== undefined)
      throw new BadRequestException('Session search is not supported');
    const sort = resolveSort(query.sortBy, ['createdAt', 'lastSeenAt'], 'createdAt');
    const [rows, count] = await this.manager
      .getRepository(SessionEntity)
      .createQueryBuilder('session')
      .where('session.userId = :userId', { userId })
      .orderBy(`session.${sort}`, query.sortOrder === 'asc' ? 'ASC' : 'DESC')
      .addOrderBy('session.id', 'ASC')
      .skip(pageOffset(query))
      .take(query.limit)
      .getManyAndCount();
    return createPage(
      rows.map((row) => ({
        id: row.id,
        deviceName: row.deviceName,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
      })),
      count,
      query,
    );
  }
}
