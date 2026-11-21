import type { EntityManager } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { ManagementRepository } from '../../../common/persistence/management.repository';
import { CompanyEntity } from '../entities/company.entity';
export class CompaniesRepository extends ManagementRepository<CompanyEntity> {
  constructor(manager: EntityManager) {
    super(CompanyEntity, manager);
  }
  async remove(id: string): Promise<void> {
    await this.require(id);
    const rows: unknown = await this.manager.query(
      'SELECT 1 FROM users WHERE company_id=$1 LIMIT 1',
      [id],
    );
    if (Array.isArray(rows) && rows.length)
      throw new ConflictException('Reassign or unlink all users before deleting the company');
    await this.delete(id);
  }
}
