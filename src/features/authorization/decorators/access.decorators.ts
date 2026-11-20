import { applyDecorators, SetMetadata } from '@nestjs/common';
import {
  AUTHENTICATED_ROUTE,
  PUBLIC_ROUTE,
  REQUIRED_PERMISSIONS,
  REQUIRED_ROLES,
} from '../../../common/security/access-metadata';

/** Explicit owner/self-service access; does not bypass any attached role/permission requirement. */
export const Authenticated = () =>
  applyDecorators(SetMetadata(PUBLIC_ROUTE, false), SetMetadata(AUTHENTICATED_ROUTE, true));
function requirement(key: string, names: string[], mode: 'all' | 'any', pattern: RegExp) {
  if (!names.length || names.some((name) => !pattern.test(name)))
    throw new Error('Invalid access requirement');
  return SetMetadata(key, { names: Object.freeze([...new Set(names)]), mode });
}
export const Roles = (...names: string[]) =>
  requirement(REQUIRED_ROLES, names, 'any', /^[a-z][a-z0-9_-]{0,79}$/);
export const AllRoles = (...names: string[]) =>
  requirement(REQUIRED_ROLES, names, 'all', /^[a-z][a-z0-9_-]{0,79}$/);
export const Permissions = (...names: string[]) =>
  requirement(REQUIRED_PERMISSIONS, names, 'all', /^[a-z][a-z0-9_-]{0,79}\.[a-z][a-z0-9_-]{0,79}$/);
export const AnyPermissions = (...names: string[]) =>
  requirement(REQUIRED_PERMISSIONS, names, 'any', /^[a-z][a-z0-9_-]{0,79}\.[a-z][a-z0-9_-]{0,79}$/);
