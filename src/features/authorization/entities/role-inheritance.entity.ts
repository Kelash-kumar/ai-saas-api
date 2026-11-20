import {
  Check,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { RoleEntity } from './role.entity';

@Entity('role_inheritance')
@Index('ix_role_inheritance_inherited_role', ['inheritedRoleId'])
@Check('ck_role_inheritance_self', 'role_id <> inherited_role_id')
export class RoleInheritanceEntity {
  @PrimaryColumn({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @ManyToOne(() => RoleEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role!: RoleEntity;

  @PrimaryColumn({ name: 'inherited_role_id', type: 'uuid' })
  inheritedRoleId!: string;

  @ManyToOne(() => RoleEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inherited_role_id' })
  inheritedRole!: RoleEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
