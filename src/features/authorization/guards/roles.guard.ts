import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ROLES } from '../../../common/security/access-metadata';
import type { AccessRequirement } from '../../../common/security/access-metadata';
import type { AuthRequest } from '../../auth/interfaces/auth.types';
import { AuthorizationService } from '../services/authorization.service';
import { satisfies } from '../policies/grant.policy';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<AccessRequirement>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (!request.principal) throw new UnauthorizedException('Authentication required');
    if (!satisfies((await this.authorization.forRequest(request)).roles, required))
      throw new ForbiddenException('Required role is missing');
    return true;
  }
}
