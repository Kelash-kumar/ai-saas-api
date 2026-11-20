import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { Exclude } from 'class-transformer';
import { BaseEntity } from '../../../common/persistence/base.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity('account_activation_tokens')
@Index('uq_activation_digest', ['tokenDigest'], { unique: true })
@Index('ix_activation_user', ['userId'])
@Index('ix_activation_expires', ['expiresAt'])
@Check('ck_activation_digest', "token_digest ~ '^[a-f0-9]{64}$'")
@Check('ck_activation_expiry', 'expires_at > created_at')
export class AccountActivationTokenEntity extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;
  @Exclude()
  @Column({ name: 'token_digest', type: 'char', length: 64, select: false })
  tokenDigest!: string;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true }) consumedAt!: Date | null;
}
