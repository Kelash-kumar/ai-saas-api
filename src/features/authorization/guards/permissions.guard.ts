import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AUTHENTICATED_ROUTE,
  PUBLIC_ROUTE,
  REQUIRED_PERMISSIONS,
  REQUIRED_ROLES,
} from '../../../common/security/access-metadata';
import type { AccessRequirement } from '../../../common/security/access-metadata';
import type { AuthRequest } from '../../auth/interfaces/auth.types';
import { AuthorizationService } from '../services/authorization.service';
import { satisfies } from '../policies/grant.policy';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<AccessRequirement>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    if (!required) {
      if (this.reflector.getAllAndOverride<AccessRequirement>(REQUIRED_ROLES, targets)) return true;
      if (
        this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets) ||
        this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ROUTE, targets)
      )
        return true;
      throw new ForbiddenException('Route has no declared access policy');
    }
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (!request.principal) throw new UnauthorizedException('Authentication required');
    if (!satisfies((await this.authorization.forRequest(request)).permissions, required))
      throw new ForbiddenException('Required permission is missing');
    return true;
  }
}
