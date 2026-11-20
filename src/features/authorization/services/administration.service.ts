import { Inject, Injectable } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { assertGrantScope } from '../policies/grant.policy';
import type { Principal } from '../../auth/interfaces/auth.types';
import { SECURITY_MESSAGES } from '../../notifications/interfaces/mail.types';
import type { SecurityMessages } from '../../notifications/interfaces/mail.types';

@Injectable()
export class AdministrationService {
  constructor(
    private readonly authorization: AuthorizationService,
    @Inject(SECURITY_MESSAGES) private readonly messages: SecurityMessages,
  ) {}
  status(principal: Principal, userId: string, status: 'active' | 'inactive') {
    return this.authorization.mutate(
      principal,
      ['users.update_status'],
      [userId],
      async (repository, actor) => {
        const target = await repository.user(userId);
        assertGrantScope(actor, await repository.userAuthority(userId));
        // Obtain the same scoped repository via an explicit manager adapter, never a second transaction.
        const recovery = repository.recovery();
        const at = new Date();
        await repository.setManagedStatus(userId, status);
        await recovery.invalidateRecovery(userId, at);
        await recovery.revokeAll(userId, at);
        if (target.status !== status)
          await recovery.enqueue(
            this.messages.prepare(
              status === 'active' ? 'account_restored' : 'account_suspended',
              target.email,
            ),
          );
      },
    );
  }
  unlock(principal: Principal, userId: string) {
    return this.authorization.mutate(
      principal,
      ['users.unlock'],
      [userId],
      async (repository, actor) => {
        await repository.user(userId);
        assertGrantScope(actor, await repository.userAuthority(userId));
        const recovery = repository.recovery();
        await recovery.setLoginState(userId, 0, null);
        // An administrative unlock never revives credentials that could have been compromised.
        await recovery.revokeAll(userId, new Date());
      },
    );
  }
}
