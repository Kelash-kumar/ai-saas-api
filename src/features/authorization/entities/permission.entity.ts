import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/persistence/base.entity';

@Entity('permissions')
@Index('uq_permissions_name', ['name'], { unique: true })
@Check('ck_permissions_resource', `resource ~ '^[a-z][a-z0-9_-]{0,79}$'`)
@Check('ck_permissions_action', `action ~ '^[a-z][a-z0-9_-]{0,79}$'`)
export class PermissionEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 80 })
  resource!: string;

  @Column({ type: 'varchar', length: 80 })
  action!: string;

  @Column({
    type: 'varchar',
    length: 161,
    asExpression: `"resource" || '.' || "action"`,
    generatedType: 'STORED',
  })
  name!: string;
}
