export const PUBLIC_ROUTE = 'auth:public';
export const AUTHENTICATED_ROUTE = 'authorization:authenticated';
export const REQUIRED_ROLES = 'authorization:roles';
export const REQUIRED_PERMISSIONS = 'authorization:permissions';
export interface AccessRequirement {
  names: readonly string[];
  mode: 'all' | 'any';
}
