import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../../common/persistence/base.repository';
import { PermissionEntity } from '../entities/permission.entity';

export class PermissionsRepository extends BaseRepository<PermissionEntity> {
  constructor(manager: EntityManager) {
    super(PermissionEntity, manager);
  }
}
