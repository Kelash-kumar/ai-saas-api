import { Check, Column, Entity, Index, DeleteDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { CompanyEntity } from '../../companies/entities/company.entity';
import { Exclude } from 'class-transformer';
import { BaseEntity } from '../../../common/persistence/base.entity';

@Entity('users')
@Index('uq_users_email', ['email'], { unique: true })
@Index('ix_users_created_id', ['createdAt', 'id'])
@Index('ix_users_company', ['companyId'])
@Check('ck_users_email_normalized', `email = lower(btrim(email)) AND length(email) > 3`)
@Check('ck_users_status', `status IN ('active', 'inactive')`)
@Check('ck_users_login_attempts', 'failed_login_attempts >= 0')
@Check(
  'ck_users_deactivation_source',
  "deactivation_source IS NULL OR deactivation_source IN ('self', 'administrative')",
)
export class UserEntity extends BaseEntity {
  @Column({ name: 'first_name', type: 'varchar', length: 100, nullable: true })
  firstName!: string | null;

  @Column({ name: 'last_name', type: 'varchar', length: 100, nullable: true })
  lastName!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId!: string | null;

  @ManyToOne(() => CompanyEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'company_id', foreignKeyConstraintName: 'fk_users_company' })
  company?: CompanyEntity | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Exclude()
  @Column({ name: 'password_hash', type: 'varchar', length: 255, select: false })
  passwordHash!: string;

  @Column({ name: 'user_type', type: 'varchar', length: 40, default: 'customer' })
  userType!: string;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: 'active' | 'inactive';

  @Column({ name: 'deactivation_source', type: 'varchar', length: 16, nullable: true })
  deactivationSource!: 'self' | 'administrative' | null;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @Column({ name: 'failed_login_attempts', type: 'integer', default: 0 })
  failedLoginAttempts!: number;
}
