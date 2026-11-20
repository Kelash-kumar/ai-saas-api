import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtAuthenticationGuard } from './jwt-authentication.guard';
import { RolesGuard } from '../../authorization/guards/roles.guard';
import { PermissionsGuard } from '../../authorization/guards/permissions.guard';

/** Core's throttler runs first; all identity/authority checks have one explicit registration order. */
@Injectable()
export class AccessPipelineGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtAuthenticationGuard,
    private readonly roles: RolesGuard,
    private readonly permissions: PermissionsGuard,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(await this.jwt.canActivate(context))) return false;
    if (!(await this.roles.canActivate(context))) return false;
    return this.permissions.canActivate(context);
  }
}
