export interface Authority {
  roleIds: string[];
  roles: string[];
  permissions: string[];
}
export interface RequestAuthority extends Authority {
  userId: string;
}
export const systemPermissions = [
  'admin.access',
  'admins.read',
  'admins.create',
  'admins.update',
  'admins.delete',
  'admins.restore',
  'admins.export',
  'users.restore',
  'users.export',
  'companies.restore',
  'companies.export',
  'roles.export',
  'permissions.export',
  'roles.read',
  'roles.create',
  'roles.update',
  'roles.delete',
  'roles.assign',
  'roles.delegate',
  'permissions.read',
  'permissions.create',
  'permissions.assign',
  'permissions.revoke',
  'users.read',
  'users.create',
  'users.update',
  'users.delete',
  'companies.read',
  'companies.create',
  'companies.update',
  'companies.delete',
  'users.update_status',
  'users.unlock',
] as const;
/** Keep at least one eligible identity capable of repairing delegation once one exists. */
export const recoveryPermissions = [
  'roles.delegate',
  'roles.assign',
  'permissions.assign',
  'permissions.revoke',
] as const;
