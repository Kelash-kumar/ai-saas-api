import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_ROUTE } from '../decorators/auth.decorators';
import { REQUIRED_ROLES, REQUIRED_PERMISSIONS } from '../../../common/security/access-metadata';
import type { AccessRequirement } from '../../../common/security/access-metadata';
import type { AuthRequest } from '../interfaces/auth.types';
import { JwtStrategy } from '../strategies/jwt.strategy';

@Injectable()
export class JwtAuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly strategy: JwtStrategy,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const restricted =
      this.reflector.getAllAndOverride<AccessRequirement>(REQUIRED_ROLES, targets) ||
      this.reflector.getAllAndOverride<AccessRequirement>(REQUIRED_PERMISSIONS, targets);
    if (
      !restricted &&
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i);
    if (!match?.[1]) throw new UnauthorizedException('Authentication required');
    request.principal = await this.strategy.authenticate(match[1]);
    return true;
  }
}
