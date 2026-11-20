import { assertGrantScope, assertPermissionScope, satisfies } from './grant.policy';

describe('Grant policy', () => {
  it('matches exact named authorities with explicit all/any semantics', () => {
    expect(satisfies(['users.read'], { names: ['users.read', 'users.update'], mode: 'all' })).toBe(
      false,
    );
    expect(satisfies(['users.read'], { names: ['users.read', 'users.update'], mode: 'any' })).toBe(
      true,
    );
    expect(satisfies(['users.*'], { names: ['users.read'], mode: 'all' })).toBe(false);
    expect(satisfies([], { names: [], mode: 'all' })).toBe(false);
  });
  it('requires both permission and role-identity scope unless delegation is explicit', () => {
    const actor = { roleIds: ['held'], roles: ['reader'], permissions: ['users.read'] };
    expect(() =>
      assertGrantScope(actor, { roleIds: ['unheld'], roles: ['privileged-name'], permissions: [] }),
    ).toThrow('grant scope');
    expect(() =>
      assertGrantScope(actor, {
        roleIds: ['held'],
        roles: ['reader'],
        permissions: ['users.update'],
      }),
    ).toThrow('grant scope');
    expect(() =>
      assertGrantScope(
        { ...actor, permissions: [...actor.permissions, 'roles.delegate'] },
        { roleIds: ['unheld'], roles: ['another'], permissions: ['users.read'] },
      ),
    ).not.toThrow();
    expect(() => assertPermissionScope(actor, 'users.update')).toThrow('grant scope');
  });
});
