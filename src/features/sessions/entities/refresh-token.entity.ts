import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { Exclude } from 'class-transformer';
import { BaseEntity } from '../../../common/persistence/base.entity';
import { SessionEntity } from './session.entity';

@Entity('refresh_tokens')
@Index('uq_refresh_digest', ['tokenDigest'], { unique: true })
@Index('uq_refresh_parent', ['parentId'], { unique: true })
@Index('ix_refresh_session', ['sessionId'])
@Index('ix_refresh_expires', ['expiresAt'])
@Unique('uq_refresh_id_session', ['id', 'sessionId'])
@Check('ck_refresh_digest', `token_digest ~ '^[a-f0-9]{64}$'`)
@Check('ck_refresh_expiry', 'expires_at > created_at')
@Check('ck_refresh_parent', 'parent_id IS NULL OR parent_id <> id')
export class RefreshTokenEntity extends BaseEntity {
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @ManyToOne(() => SessionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session!: SessionEntity;

  @Exclude()
  @Column({ name: 'token_digest', type: 'char', length: 64, select: false })
  tokenDigest!: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => RefreshTokenEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn([
    { name: 'parent_id', referencedColumnName: 'id' },
    { name: 'session_id', referencedColumnName: 'sessionId' },
  ])
  parent!: RefreshTokenEntity | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
