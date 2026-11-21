import { Column, Entity, Index, ManyToOne, JoinColumn } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { BaseEntity } from '../../../common/persistence/base.entity';
@Entity('login_challenges')
@Index('uq_login_challenge_digest', ['tokenDigest'], { unique: true })
export class LoginChallengeEntity extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'fk_login_challenges_user' })
  user?: UserEntity;
  @Column({ name: 'token_digest', type: 'varchar', length: 64 }) tokenDigest!: string;
  @Column({ name: 'code_digest', type: 'varchar', length: 64 }) codeDigest!: string;
  @Column({ name: 'credential_stamp', type: 'varchar', length: 64 }) credentialStamp!: string;
  @Column({ name: 'admin_portal', default: false }) adminPortal!: boolean;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ default: 0 }) attempts!: number;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true }) consumedAt!: Date | null;
}
