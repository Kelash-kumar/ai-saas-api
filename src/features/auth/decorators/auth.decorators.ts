import { createParamDecorator, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthRequest, Principal } from '../interfaces/auth.types';

import { PUBLIC_ROUTE } from '../../../common/security/access-metadata';
export { PUBLIC_ROUTE } from '../../../common/security/access-metadata';
/** Bypasses only the global JWT guard, never throttling or route guards. */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const principal = context.switchToHttp().getRequest<AuthRequest>().principal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    return principal;
  },
);
