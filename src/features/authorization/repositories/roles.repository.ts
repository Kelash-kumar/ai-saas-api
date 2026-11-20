import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../../common/persistence/base.repository';
import { RoleEntity } from '../entities/role.entity';
import { RoleInheritanceEntity } from '../entities/role-inheritance.entity';

export class RolesRepository extends BaseRepository<RoleEntity> {
  constructor(manager: EntityManager) {
    super(RoleEntity, manager);
  }

  /** Database trigger enforces acyclic inheritance even for concurrent/direct SQL writes. */
  inherit(roleId: string, inheritedRoleId: string): Promise<RoleInheritanceEntity> {
    return this.execute(async () => {
      void this.repository; // Assert a scoped repository is still inside its transaction.
      return this.manager.getRepository(RoleInheritanceEntity).save({ roleId, inheritedRoleId });
    });
  }
}
