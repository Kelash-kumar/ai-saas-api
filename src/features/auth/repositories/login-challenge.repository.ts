import type { EntityManager } from 'typeorm';
import { LoginChallengeEntity } from '../entities/login-challenge.entity';
import { MailOutboxEntity } from '../../notifications/entities/mail-outbox.entity';
import type { PreparedVerification } from '../interfaces/auth.types';
export class LoginChallengeRepository {
  constructor(private readonly manager: EntityManager) {}
  async create(input: Partial<LoginChallengeEntity>, mail: PreparedVerification) {
    await this.manager
      .getRepository(LoginChallengeEntity)
      .update({ userId: input.userId }, { consumedAt: new Date() });
    await this.manager.getRepository(LoginChallengeEntity).insert(input);
    await this.manager.getRepository(MailOutboxEntity).insert(mail);
  }
  find(tokenDigest: string) {
    return this.manager.getRepository(LoginChallengeEntity).findOneBy({ tokenDigest });
  }
  lock(tokenDigest: string) {
    return this.manager
      .getRepository(LoginChallengeEntity)
      .createQueryBuilder('challenge')
      .where({ tokenDigest })
      .setLock('pessimistic_write')
      .getOne();
  }
  update(id: string, input: Partial<LoginChallengeEntity>) {
    return this.manager.getRepository(LoginChallengeEntity).update(id, input);
  }
}
