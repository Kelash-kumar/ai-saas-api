import { BadRequestException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { AuthorizationRepository } from './repositories/authorization.repository';
import { PermissionEntity } from './entities/permission.entity';
import { UserEntity } from '../users/entities/user.entity';
import { systemPermissions } from './interfaces/authority';

/** Trusted operator entry only. It never creates users, verifies email or assigns a magic role. */
export async function operatorGrant(
  source: DataSource,
  email: string,
  bootstrap: boolean,
  requested: string[] = [],
): Promise<void> {
  await source.transaction('READ COMMITTED', (manager) =>
    grantOperatorPermissions(manager, email, bootstrap, requested),
  );
}

/** Trusted CLI composition in the caller's active transaction. */
export async function grantOperatorPermissions(
  manager: EntityManager,
  email: string,
  bootstrap: boolean,
  requested: string[] = [],
): Promise<void> {
  const repository = new AuthorizationRepository(manager);
  await repository.lockPolicy();
  const candidate = await manager
    .getRepository(UserEntity)
    .findOneBy({ email: email.trim().toLowerCase() });
  if (!candidate)
    throw new BadRequestException(
      'Register and verify the intended account before granting authority',
    );
  await repository.lockUsers([candidate.id]);
  const user = await repository.user(candidate.id);
  if (
    user.status !== 'active' ||
    !user.emailVerifiedAt ||
    (user.lockedUntil && user.lockedUntil > new Date())
  )
    throw new BadRequestException('Operator grants require an eligible active verified account');
  if (bootstrap) {
    for (const name of systemPermissions) {
      const [resource, action] = name.split('.');
      if (!resource || !action) throw new Error('Invalid system catalog');
      await manager
        .getRepository(PermissionEntity)
        .createQueryBuilder()
        .insert()
        .values({ resource, action })
        .orIgnore()
        .execute();
    }
  }
  const names: readonly string[] = bootstrap ? systemPermissions : requested;
  if (!names.length) throw new BadRequestException('Supply at least one existing permission');
  for (const name of names) {
    const permission = await manager.getRepository(PermissionEntity).findOneBy({ name });
    if (!permission) throw new BadRequestException('Requested permission is not in the catalog');
    await repository.directPermission(user.id, permission.id, true);
  }
}
