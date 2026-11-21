import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/persistence/base.entity';
@Entity('companies')
@Index('uq_companies_email', ['email'], { unique: true })
@Index('ix_companies_created_id', ['createdAt', 'id'])
@Check('ck_companies_name', 'length(btrim(name)) > 0')
@Check('ck_companies_email', 'email IS NULL OR (email = lower(btrim(email)) AND length(email) > 3)')
export class CompanyEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 160 }) name!: string;
  @Column({ type: 'varchar', length: 320, nullable: true }) email!: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) phone!: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) website!: string | null;
  @Column({ type: 'varchar', length: 2000, nullable: true }) address!: string | null;
}
