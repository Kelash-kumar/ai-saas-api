import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/persistence/base.entity';
import { UserEntity } from '../../users/entities/user.entity';

@Entity('sessions')
@Index('ix_sessions_user', ['userId'])
@Index('ix_sessions_expires', ['expiresAt'])
@Check('ck_sessions_expiry', 'expires_at > created_at')
export class SessionEntity extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'device_name', type: 'varchar', length: 120, nullable: true })
  deviceName!: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true, select: false })
  userAgent!: string | null;

  @Column({ name: 'ip_address', type: 'inet', nullable: true, select: false })
  ipAddress!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'last_seen_at', type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;
}
