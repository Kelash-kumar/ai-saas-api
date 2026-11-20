import { Check, Column, Entity, Index } from 'typeorm';
import { Exclude } from 'class-transformer';
import { BaseEntity } from '../../../common/persistence/base.entity';

/** Encrypted payload and durable worker lease, retry and terminal state. */
@Entity('mail_outbox')
@Index('ix_outbox_pending', ['availableAt', 'id'], {
  where: 'processed_at IS NULL AND dead_at IS NULL',
})
@Check('ck_outbox_lease', '(lease_id IS NULL) = (leased_until IS NULL)')
@Check('ck_outbox_attempts', 'attempts >= 0')
@Check('ck_outbox_payload', 'octet_length(payload_ciphertext) > 0')
export class MailOutboxEntity extends BaseEntity {
  @Exclude()
  @Column({ type: 'varchar', length: 320, select: false })
  recipient!: string;

  @Column({ type: 'varchar', length: 60 })
  template!: string;

  @Exclude()
  @Column({ name: 'payload_ciphertext', type: 'bytea', select: false })
  payloadCiphertext!: Buffer;

  @Column({ name: 'key_id', type: 'varchar', length: 64 })
  keyId!: string;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 80, nullable: true })
  lastErrorCode!: string | null;

  @Column({ name: 'lease_id', type: 'uuid', nullable: true }) leaseId!: string | null;
  @Column({ name: 'leased_until', type: 'timestamptz', nullable: true }) leasedUntil!: Date | null;
  @Column({ name: 'dead_at', type: 'timestamptz', nullable: true }) deadAt!: Date | null;
}
