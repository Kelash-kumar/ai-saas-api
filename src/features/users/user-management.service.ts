import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthorizationService } from '../authorization/services/authorization.service';
import { assertGrantScope } from '../authorization/policies/grant.policy';
import { CompaniesRepository } from '../companies/repositories/companies.repository';
import { RegistrationService } from '../auth/services/registration.service';
import { PASSWORD_HASHER } from '../auth/interfaces/auth.types';
import type { PasswordHasher, Principal } from '../auth/interfaces/auth.types';
import { TypeormUsersRepository } from './repositories/typeorm-users.repository';
import { UserEntity } from './entities/user.entity';
import type {
  CreateManagedUserDto,
  UpdateManagedUserDto,
  UserManagementQueryDto,
} from './dto/user-management.dto';
function view(row: UserEntity) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    companyId: row.companyId,
    status: row.status,
    emailVerifiedAt: row.emailVerifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
@Injectable()
export class UserManagementService {
  constructor(
    private readonly source: DataSource,
    private readonly authorization: AuthorizationService,
    private readonly registration: RegistrationService,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
  ) {}
  async list(query: UserManagementQueryDto) {
    const page = await new TypeormUsersRepository(this.source.manager).searchPage(
      query,
      ['email', 'firstName', 'lastName'],
      ['id', 'email', 'firstName', 'lastName', 'createdAt', 'updatedAt', 'status'],
      query.companyId ? { companyId: query.companyId } : {},
    );
    return { ...page, data: page.data.map(view) };
  }
  async find(id: string) {
    return view(await new TypeormUsersRepository(this.source.manager).require(id));
  }
  async create(principal: Principal, input: CreateManagedUserDto) {
    const hash = await this.passwords.hash(input.password);
    return this.authorization.mutate(
      principal,
      ['users.create'],
      [],
      async (repository, _actor, scope) => {
        if (input.companyId) await scope.get(CompaniesRepository).require(input.companyId);
        const id = await this.registration.provision(repository.recovery(), input.email, hash);
        if (!id) throw new ConflictException('Resource already exists');
        const users = scope.get(TypeormUsersRepository);
        await users.update(id, {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone ?? null,
          companyId: input.companyId ?? null,
        });
        return view(await users.require(id));
      },
    );
  }
  update(principal: Principal, id: string, input: UpdateManagedUserDto) {
    return this.authorization.mutate(
      principal,
      ['users.update'],
      [id],
      async (repository, actor, scope) => {
        await repository.user(id);
        assertGrantScope(actor, await repository.userAuthority(id));
        if (input.companyId) await scope.get(CompaniesRepository).require(input.companyId);
        const users = scope.get(TypeormUsersRepository);
        if (Object.keys(input).length) await users.update(id, input);
        return view(await users.require(id));
      },
    );
  }
  remove(principal: Principal, id: string) {
    return this.authorization.mutate(
      principal,
      ['users.delete'],
      [id],
      async (repository, actor, scope) => {
        await repository.user(id);
        assertGrantScope(actor, await repository.userAuthority(id));
        const at = new Date();
        const recovery = repository.recovery();
        await recovery.invalidateRecovery(id, at);
        await recovery.revokeAll(id, at);
        await scope
          .get(TypeormUsersRepository)
          .update(id, { status: 'inactive', deactivationSource: 'administrative', deletedAt: at });
      },
    );
  }
}
