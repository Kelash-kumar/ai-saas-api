import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/persistence/base.entity';

@Entity('roles')
@Index('uq_roles_name', ['name'], { unique: true })
export class RoleEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;
}
