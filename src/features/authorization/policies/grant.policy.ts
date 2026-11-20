import { ForbiddenException } from '@nestjs/common';
import type { Authority } from '../interfaces/authority';
import type { AccessRequirement } from '../../../common/security/access-metadata';

export function satisfies(held: readonly string[], requirement: AccessRequirement): boolean {
  if (!requirement.names.length) return false;
  return requirement.mode === 'all'
    ? requirement.names.every((name) => held.includes(name))
    : requirement.names.some((name) => held.includes(name));
}
/** Permission ceilings always apply. Role-name delegation requires an explicit capability or held role. */
export function assertGrantScope(actor: Authority, affected: Authority): void {
  if (
    affected.permissions.some((permission) => !actor.permissions.includes(permission)) ||
    (!actor.permissions.includes('roles.delegate') &&
      affected.roleIds.some((role) => !actor.roleIds.includes(role)))
  ) {
    throw new ForbiddenException('Requested change exceeds your grant scope');
  }
}
export function assertPermissionScope(actor: Authority, permission: string): void {
  if (!actor.permissions.includes(permission))
    throw new ForbiddenException('Requested change exceeds your grant scope');
}
