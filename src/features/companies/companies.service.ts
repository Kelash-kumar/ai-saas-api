import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthorizationService } from '../authorization/services/authorization.service';
import type { Principal } from '../auth/interfaces/auth.types';
import type { PageQueryDto } from '../../common/pagination/page-query.dto';
import { CompaniesRepository } from './repositories/companies.repository';
import type { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';
import type { CompanyEntity } from './entities/company.entity';
function view(row: CompanyEntity) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    website: row.website,
    address: row.address,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
@Injectable()
export class CompaniesService {
  constructor(
    private readonly source: DataSource,
    private readonly authorization: AuthorizationService,
  ) {}
  async list(query: PageQueryDto) {
    const page = await new CompaniesRepository(this.source.manager).searchPage(
      query,
      ['name', 'email'],
      ['id', 'name', 'email', 'createdAt', 'updatedAt'],
    );
    return { ...page, data: page.data.map(view) };
  }
  async find(id: string) {
    return view(await new CompaniesRepository(this.source.manager).require(id));
  }
  create(principal: Principal, data: CreateCompanyDto) {
    return this.authorization.mutate(
      principal,
      ['companies.create'],
      [],
      async (_repository, _actor, scope) => view(await scope.get(CompaniesRepository).create(data)),
    );
  }
  update(principal: Principal, id: string, data: UpdateCompanyDto) {
    return this.authorization.mutate(
      principal,
      ['companies.update'],
      [],
      async (_repository, _actor, scope) => {
        const repository = scope.get(CompaniesRepository);
        await repository.require(id);
        if (Object.keys(data).length) await repository.update(id, data);
        return view(await repository.require(id));
      },
    );
  }
  remove(principal: Principal, id: string) {
    return this.authorization.mutate(
      principal,
      ['companies.delete'],
      [],
      (_repository, _actor, scope) => scope.get(CompaniesRepository).remove(id),
    );
  }
}
