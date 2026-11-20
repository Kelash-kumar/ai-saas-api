import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { AppLogger } from '../../../core/logging/app-logger.service';
import { AuthorizationRepository } from '../repositories/authorization.repository';
import { assertGrantScope, assertPermissionScope } from '../policies/grant.policy';
import type { Authority } from '../interfaces/authority';
import type { AuthRequest, Principal } from '../../auth/interfaces/auth.types';
import type { PageQueryDto } from '../../../common/pagination/page-query.dto';

@Injectable()
export class AuthorizationService {
  constructor(
    private readonly source: DataSource,
    private readonly work: UnitOfWork,
    private readonly logger: AppLogger,
  ) {}
  authority(userId: string) {
    return new AuthorizationRepository(this.source.manager).userAuthority(userId);
  }
  async forRequest(request: AuthRequest): Promise<Authority> {
    if (!request.principal)
      throw new ForbiddenException('Authority requires an authenticated identity');
    if (!request.authority || request.authority.userId !== request.principal.userId) {
      request.authority = {
        userId: request.principal.userId,
        ...(await this.authority(request.principal.userId)),
      };
    }
    return request.authority;
  }
  roles(query: PageQueryDto) {
    return new AuthorizationRepository(this.source.manager).roles(query);
  }
  permissions(query: PageQueryDto) {
    return new AuthorizationRepository(this.source.manager).permissions(query);
  }
  role(id: string) {
    return new AuthorizationRepository(this.source.manager).details(id);
  }
  users(query: PageQueryDto) {
    return new AuthorizationRepository(this.source.manager).users(query);
  }
  async userAuthority(userId: string) {
    const repository = new AuthorizationRepository(this.source.manager);
    await repository.user(userId);
    return repository.userAuthority(userId);
  }

  /** The HTTP guard is a first boundary; mutation authority is read again after the policy lock. */
  async mutate<T>(
    principal: Principal,
    required: readonly string[],
    userIds: string[],
    work: (repository: AuthorizationRepository, actor: Authority) => Promise<T>,
  ): Promise<T> {
    const result = await this.work.run(async (scope) => {
      const repository = scope.get(AuthorizationRepository);
      await repository.lockPolicy();
      await repository.lockUsers([principal.userId, ...userIds]);
      await repository.requireActor(principal);
      const actor = await repository.userAuthority(principal.userId);
      if (required.some((permission) => !actor.permissions.includes(permission)))
        throw new ForbiddenException('Insufficient permission');
      const hadRecovery = await repository.hasRecoveryManager();
      const value = await work(repository, actor);
      if (hadRecovery && !(await repository.hasRecoveryManager()))
        throw new ConflictException('Change would remove the last eligible delegation manager');
      return value;
    });
    this.logger.security('authorization.changed', principal.userId);
    return result;
  }
  createRole(principal: Principal, name: string, description?: string) {
    return this.mutate(principal, ['roles.create', 'roles.delegate'], [], (repository) =>
      repository.createRole(name, description),
    );
  }
  updateRole(principal: Principal, roleId: string, description: string) {
    return this.mutate(principal, ['roles.update'], [], async (repository, actor) => {
      await repository.role(roleId);
      assertGrantScope(actor, await repository.roleImpact(roleId));
      return repository.updateRole(roleId, description);
    });
  }
  deleteRole(principal: Principal, roleId: string) {
    return this.mutate(principal, ['roles.delete'], [], async (repository, actor) => {
      await repository.role(roleId);
      assertGrantScope(actor, await repository.roleImpact(roleId));
      await repository.deleteRole(roleId);
    });
  }
  createPermission(principal: Principal, resource: string, action: string) {
    // Creating a catalog entry grants it to nobody. A trusted operator must authorize its first grant.
    return this.mutate(principal, ['permissions.create'], [], (repository) =>
      repository.createPermission(resource, action),
    );
  }
  membership(principal: Principal, userId: string, roleId: string, grant: boolean) {
    return this.mutate(principal, ['roles.assign'], [userId], async (repository, actor) => {
      await repository.user(userId);
      await repository.role(roleId);
      assertGrantScope(actor, await repository.userAuthority(userId));
      assertGrantScope(actor, await repository.roleAuthority(roleId));
      await repository.membership(userId, roleId, grant);
    });
  }
  directPermission(principal: Principal, userId: string, permissionId: string, grant: boolean) {
    return this.mutate(
      principal,
      [grant ? 'permissions.assign' : 'permissions.revoke'],
      [userId],
      async (repository, actor) => {
        await repository.user(userId);
        const permission = await repository.permission(permissionId);
        assertGrantScope(actor, await repository.userAuthority(userId));
        assertPermissionScope(actor, permission.name);
        await repository.directPermission(userId, permissionId, grant);
      },
    );
  }
  rolePermission(principal: Principal, roleId: string, permissionId: string, grant: boolean) {
    return this.mutate(
      principal,
      [grant ? 'permissions.assign' : 'permissions.revoke'],
      [],
      async (repository, actor) => {
        await repository.role(roleId);
        const permission = await repository.permission(permissionId);
        assertGrantScope(actor, await repository.roleImpact(roleId));
        assertPermissionScope(actor, permission.name);
        await repository.rolePermission(roleId, permissionId, grant);
      },
    );
  }
  inheritance(principal: Principal, roleId: string, inheritedRoleId: string, grant: boolean) {
    return this.mutate(principal, ['roles.update'], [], async (repository, actor) => {
      await repository.role(roleId);
      await repository.role(inheritedRoleId);
      assertGrantScope(actor, await repository.roleImpact(roleId));
      assertGrantScope(actor, await repository.roleAuthority(inheritedRoleId));
      await repository.inheritance(roleId, inheritedRoleId, grant);
    });
  }
}
