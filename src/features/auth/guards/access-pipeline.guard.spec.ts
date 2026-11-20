import type { ExecutionContext } from '@nestjs/common';
import { AccessPipelineGuard } from './access-pipeline.guard';
import type { JwtAuthenticationGuard } from './jwt-authentication.guard';
import type { RolesGuard } from '../../authorization/guards/roles.guard';
import type { PermissionsGuard } from '../../authorization/guards/permissions.guard';

describe('Security guard composition', () => {
  it('authenticates before role and permission checks', async () => {
    const order: string[] = [];
    const jwt = {
      canActivate: jest.fn(() => {
        order.push('jwt');
        return true;
      }),
    };
    const roles = {
      canActivate: jest.fn(() => {
        order.push('roles');
        return true;
      }),
    };
    const permissions = {
      canActivate: jest.fn(() => {
        order.push('permissions');
        return true;
      }),
    };
    const guard = new AccessPipelineGuard(
      jwt as unknown as JwtAuthenticationGuard,
      roles as unknown as RolesGuard,
      permissions as unknown as PermissionsGuard,
    );
    expect(await guard.canActivate({} as ExecutionContext)).toBe(true);
    expect(order).toEqual(['jwt', 'roles', 'permissions']);
  });
  it('never ignores a false guard result or invokes downstream guards after denial', async () => {
    const jwt = { canActivate: jest.fn().mockResolvedValue(true) };
    const roles = { canActivate: jest.fn().mockResolvedValue(false) };
    const permissions = { canActivate: jest.fn().mockResolvedValue(true) };
    const guard = new AccessPipelineGuard(
      jwt as unknown as JwtAuthenticationGuard,
      roles as unknown as RolesGuard,
      permissions as unknown as PermissionsGuard,
    );
    expect(await guard.canActivate({} as ExecutionContext)).toBe(false);
    expect(permissions.canActivate).not.toHaveBeenCalled();
    jwt.canActivate.mockResolvedValue(false);
    roles.canActivate.mockClear();
    expect(await guard.canActivate({} as ExecutionContext)).toBe(false);
    expect(roles.canActivate).not.toHaveBeenCalled();
  });
});
