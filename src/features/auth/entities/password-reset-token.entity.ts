import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Exclude } from 'class-transformer';
import { BaseEntity } from '../../../common/persistence/base.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity('password_reset_tokens')
@Index('uq_password_reset_tokens_digest', ['tokenDigest'], { unique: true })
@Index('ix_password_reset_tokens_user', ['userId'])
@Index('ix_password_reset_tokens_expires', ['expiresAt'])
@Check('ck_password_reset_tokens_digest', `token_digest ~ '^[a-f0-9]{64}$'`)
@Check('ck_password_reset_tokens_expiry', 'expires_at > created_at')
export class PasswordResetTokenEntity extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Exclude()
  @Column({ name: 'token_digest', type: 'char', length: 64, select: false })
  tokenDigest!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
}
