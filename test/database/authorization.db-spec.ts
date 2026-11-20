import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { DatabaseHarness } from './database-harness';
import { createTestApplication } from '../support/test-application';
import { Public } from '../../src/features/auth/decorators/auth.decorators';
import {
  Authenticated,
  Roles,
  Permissions,
  AnyPermissions,
} from '../../src/features/authorization/decorators/access.decorators';
import { AuthorizationService } from '../../src/features/authorization/services/authorization.service';
import { UserEntity } from '../../src/features/users/entities/user.entity';
import { SessionEntity } from '../../src/features/sessions/entities/session.entity';
import { PermissionEntity } from '../../src/features/authorization/entities/permission.entity';
import { RoleEntity } from '../../src/features/authorization/entities/role.entity';
import { UserRoleEntity } from '../../src/features/authorization/entities/user-role.entity';
import { UserPermissionEntity } from '../../src/features/authorization/entities/user-permission.entity';
import { RolePermissionEntity } from '../../src/features/authorization/entities/role-permission.entity';
import { RoleInheritanceEntity } from '../../src/features/authorization/entities/role-inheritance.entity';
import { MailOutboxEntity } from '../../src/features/notifications/entities/mail-outbox.entity';
import { AccessTokenService } from '../../src/features/auth/crypto/access-token.service';
import type { Principal } from '../../src/features/auth/interfaces/auth.types';
import { operatorGrant } from '../../src/features/authorization/bootstrap';

@Controller({ path: 'policy-fixture', version: '1' })
class PolicyFixture {
  @Get('public') @Public() public() {
    return { allowed: true };
  }
  @Get('undeclared') undeclared() {
    return { allowed: true };
  }
  @Get('self') @Authenticated() self() {
    return { allowed: true };
  }
  @Get('role') @Roles('reviewer') role() {
    return { allowed: true };
  }
  @Get('permission') @Permissions('reports.view') permission() {
    return { allowed: true };
  }
  @Get('both') @Roles('reviewer') @Permissions('reports.view') both() {
    return { allowed: true };
  }
  @Get('any') @AnyPermissions('reports.view', 'reports.export') any() {
    return { allowed: true };
  }
  @Get('public-restricted') @Public() @Permissions('reports.view') publicRestricted() {
    return { allowed: true };
  }
}
@Controller({ path: 'policy-override', version: '1' })
@Permissions('reports.view')
class OverrideFixture {
  @Get('default') original() {
    return { allowed: true };
  }
  @Get('override') @Permissions('reports.export') override() {
    return { allowed: true };
  }
}
@Controller({ path: 'public-override', version: '1' })
@Public()
class PublicOverrideFixture {
  @Get() open() {
    return { allowed: true };
  }
  @Get('private') @Authenticated() private() {
    return { allowed: true };
  }
}

interface Identity {
  id: string;
  token: string;
  principal: Principal;
}
const origin = 'https://app.example.com';
describe('Dynamic RBAC and management boundaries', () => {
  let db: DatabaseHarness;
  let app: NestExpressApplication;
  beforeAll(async () => {
    db = await DatabaseHarness.create();
  });
  beforeEach(async () => {
    await db.reset();
    app = await createTestApplication(
      [PolicyFixture, OverrideFixture, PublicOverrideFixture],
      { SWAGGER_ENABLED: true },
      await new DataSource(db.source.options).initialize(),
    );
  });
  afterEach(async () => {
    if (app) await app.close();
  });
  afterAll(async () => {
    if (db) await db.close();
  });
  const api = () => request(app.getHttpServer());
  async function identity(email = `${randomUUID()}@example.com`): Promise<Identity> {
    const user = await db.source.getRepository(UserEntity).save({
      email,
      passwordHash: 'fixture-not-a-login-password',
      emailVerifiedAt: new Date(),
      userType: 'customer',
    });
    const session = await db.source
      .getRepository(SessionEntity)
      .save({ userId: user.id, expiresAt: new Date(Date.now() + 3600000) });
    const token = await app.get(AccessTokenService).sign(user.id, session.id, 900);
    return {
      id: user.id,
      token,
      principal: { userId: user.id, sessionId: session.id, email, userType: 'customer' },
    };
  }
  async function admin(): Promise<Identity> {
    const actor = await identity();
    await operatorGrant(db.source, actor.principal.email, true);
    return actor;
  }
  async function permission(name: string): Promise<PermissionEntity> {
    const repository = db.source.getRepository(PermissionEntity);
    const existing = await repository.findOneBy({ name });
    if (existing) return existing;
    const [resource, action] = name.split('.');
    return repository.save({ resource, action });
  }
  async function give(actor: Identity, ...names: string[]) {
    for (const name of names)
      await db.source
        .getRepository(UserPermissionEntity)
        .insert({ userId: actor.id, permissionId: (await permission(name)).id });
  }
  const get = (path: string, actor?: Identity) =>
    actor
      ? api().get(`/api/v1/${path}`).auth(actor.token, { type: 'bearer' })
      : api().get(`/api/v1/${path}`);
  const post = (path: string, actor: Identity, body?: object) =>
    api()
      .post(`/api/v1/authorization/${path}`)
      .set('Origin', origin)
      .auth(actor.token, { type: 'bearer' })
      .send(body ?? {});
  const del = (path: string, actor: Identity) =>
    api()
      .delete(`/api/v1/authorization/${path}`)
      .set('Origin', origin)
      .auth(actor.token, { type: 'bearer' });

  it('denies undeclared policies, requires identity before authority, and permits explicit public/self access', async () => {
    const actor = await identity();
    await get('policy-fixture/public').expect(200);
    await get('policy-fixture/undeclared').expect(401);
    await get('policy-fixture/undeclared', actor).expect(403);
    await get('policy-fixture/self', actor).expect(200);
    await get('authorization/roles').expect(401);
    await get('authorization/roles', actor).expect(403);
    expect((await get('authorization/me', actor).expect(200)).body).toMatchObject({
      data: { roles: [], permissions: [] },
    });
    await get('public-override').expect(200);
    await get('public-override/private').expect(401);
    await get('public-override/private', actor).expect(200);
  });

  it('combines inherited roles, multiple roles and direct permissions without caching across requests', async () => {
    const actor = await identity();
    const root = await db.source.getRepository(RoleEntity).save({ name: 'senior' });
    const child = await db.source.getRepository(RoleEntity).save({ name: 'reviewer' });
    const other = await db.source.getRepository(RoleEntity).save({ name: 'exporter' });
    await db.source
      .getRepository(RoleInheritanceEntity)
      .insert({ roleId: root.id, inheritedRoleId: child.id });
    await db.source.getRepository(UserRoleEntity).insert([
      { userId: actor.id, roleId: root.id },
      { userId: actor.id, roleId: other.id },
    ]);
    const view = await permission('reports.view');
    const exp = await permission('reports.export');
    await db.source
      .getRepository(RolePermissionEntity)
      .insert({ roleId: child.id, permissionId: view.id });
    await db.source
      .getRepository(UserPermissionEntity)
      .insert({ userId: actor.id, permissionId: exp.id });
    await get('policy-fixture/both', actor).expect(200);
    await get('policy-fixture/any', actor).expect(200);
    const data = (await get('authorization/me', actor)).body as {
      data: { roles: string[]; permissions: string[] };
    };
    expect(data.data.roles).toEqual(['exporter', 'reviewer', 'senior']);
    expect(data.data.permissions).toEqual(['reports.export', 'reports.view']);
    await db.source
      .getRepository(RolePermissionEntity)
      .delete({ roleId: child.id, permissionId: view.id });
    await get('policy-fixture/permission', actor).expect(403);
    await get('policy-fixture/any', actor).expect(200);
    await db.source
      .getRepository(UserPermissionEntity)
      .delete({ userId: actor.id, permissionId: exp.id });
    await get('policy-fixture/any', actor).expect(403);
  });

  it('honors method overrides and never lets Public bypass attached permission requirements', async () => {
    const actor = await identity();
    await give(actor, 'reports.export');
    await get('policy-override/default', actor).expect(403);
    await get('policy-override/override', actor).expect(200);
    await get('policy-fixture/public-restricted').expect(401);
    await get('policy-fixture/public-restricted', actor).expect(403);
    await give(actor, 'reports.view');
    await get('policy-fixture/public-restricted', actor).expect(200);
  });

  it('uses one authority read for combined role/permission guards', async () => {
    const actor = await identity();
    const role = await db.source.getRepository(RoleEntity).save({ name: 'reviewer' });
    await db.source.getRepository(UserRoleEntity).insert({ userId: actor.id, roleId: role.id });
    await give(actor, 'reports.view');
    const spy = jest.spyOn(app.get(AuthorizationService), 'authority');
    await get('policy-fixture/both', actor).expect(200);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('bootstraps explicitly without changing user type and supports complete scoped role/permission CRUD', async () => {
    const actor = await admin();
    const target = await identity();
    expect(
      (await db.source.getRepository(UserEntity).findOneByOrFail({ id: actor.id })).userType,
    ).toBe('customer');
    const response = await post('roles', actor, {
      name: 'operators',
      description: 'Initial',
    }).expect(201);
    const roleId = (response.body as { data: { id: string } }).data.id;
    await api()
      .patch(`/api/v1/authorization/roles/${roleId}`)
      .set('Origin', origin)
      .auth(actor.token, { type: 'bearer' })
      .send({ description: 'Updated' })
      .expect(200);
    const read = await permission('users.read');
    await post(`roles/${roleId}/permissions/${read.id}`, actor).expect(204);
    await post(`users/${target.id}/roles/${roleId}`, actor).expect(204);
    await get('authorization/users', target).expect(200);
    const role = await get(`authorization/roles/${roleId}`, actor).expect(200);
    expect(role.body).toMatchObject({
      data: { description: 'Updated', permissions: ['users.read'] },
    });
    await del(`users/${target.id}/roles/${roleId}`, actor).expect(204);
    await get('authorization/users', target).expect(403);
    await del(`roles/${roleId}/permissions/${read.id}`, actor).expect(204);
    await del(`roles/${roleId}`, actor).expect(204);
  });

  it('creates catalog entries without automatically granting them, then accepts an explicit operator first grant', async () => {
    const actor = await admin();
    const target = await identity();
    const created = await post('permissions', actor, {
      resource: 'reports',
      action: 'view',
    }).expect(201);
    const id = (created.body as { data: { id: string } }).data.id;
    await post(`users/${target.id}/permissions/${id}`, actor).expect(403);
    await operatorGrant(db.source, actor.principal.email, false, ['reports.view']);
    await post(`users/${target.id}/permissions/${id}`, actor).expect(204);
    await get('policy-fixture/permission', target).expect(200);
    await del(`users/${target.id}/permissions/${id}`, actor).expect(204);
    await get('policy-fixture/permission', target).expect(403);
  });

  it('does not let a limited grant manager assign permissions or role-only authority they lack', async () => {
    const actor = await identity();
    const target = await identity();
    await give(actor, 'roles.assign', 'permissions.assign', 'permissions.revoke');
    const high = await permission('users.update_status');
    await post(`users/${actor.id}/permissions/${high.id}`, actor).expect(403);
    const empty = await db.source.getRepository(RoleEntity).save({ name: 'reviewer' });
    await post(`users/${actor.id}/roles/${empty.id}`, actor).expect(403);
    await post(`users/${target.id}/roles/${empty.id}`, actor).expect(403);
    await db.source
      .getRepository(RolePermissionEntity)
      .insert({ roleId: empty.id, permissionId: high.id });
    await post(`users/${target.id}/roles/${empty.id}`, actor).expect(403);
  });

  it('protects shared roles and higher-authority users from lesser managers', async () => {
    const root = await admin();
    const limited = await identity();
    await give(
      limited,
      'roles.update',
      'roles.delete',
      'roles.delegate',
      'permissions.revoke',
      'users.read',
    );
    const shared = await db.source.getRepository(RoleEntity).save({ name: 'shared-reader' });
    const read = await permission('users.read');
    await db.source
      .getRepository(RolePermissionEntity)
      .insert({ roleId: shared.id, permissionId: read.id });
    await db.source.getRepository(UserRoleEntity).insert({ userId: root.id, roleId: shared.id });
    await del(`roles/${shared.id}/permissions/${read.id}`, limited).expect(403);
    await del(`roles/${shared.id}`, limited).expect(403);
    await del(`users/${root.id}/permissions/${read.id}`, limited).expect(403);
  });

  it('protects inherited-role edits and rejects cycles through the real management API', async () => {
    const actor = await admin();
    const roles = await db.source
      .getRepository(RoleEntity)
      .save([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    const [a, b, c] = roles;
    if (!a || !b || !c) throw new Error('Missing role fixtures');
    await post(`roles/${a.id}/inherits/${b.id}`, actor).expect(204);
    await post(`roles/${b.id}/inherits/${c.id}`, actor).expect(204);
    await post(`roles/${c.id}/inherits/${a.id}`, actor).expect(400);
    await del(`roles/${b.id}/inherits/${c.id}`, actor).expect(204);
  });

  it('protects privileged inheriting roles even when editing an otherwise low-authority base', async () => {
    await admin();
    const limited = await identity();
    await give(limited, 'roles.update', 'roles.delegate', 'permissions.revoke', 'users.read');
    const base = await db.source.getRepository(RoleEntity).save({ name: 'base' });
    const parent = await db.source.getRepository(RoleEntity).save({ name: 'privileged-parent' });
    const read = await permission('users.read');
    const high = await permission('users.update_status');
    await db.source.getRepository(RolePermissionEntity).insert([
      { roleId: base.id, permissionId: read.id },
      { roleId: parent.id, permissionId: high.id },
    ]);
    await db.source
      .getRepository(RoleInheritanceEntity)
      .insert({ roleId: parent.id, inheritedRoleId: base.id });
    await del(`roles/${base.id}/permissions/${read.id}`, limited).expect(403);
  });

  it('retains permissions until every independent grant source is revoked', async () => {
    const actor = await admin();
    const target = await identity();
    const read = await permission('users.read');
    const a = await db.source.getRepository(RoleEntity).save({ name: 'read-a' });
    const b = await db.source.getRepository(RoleEntity).save({ name: 'read-b' });
    await db.source.getRepository(UserRoleEntity).insert([
      { userId: target.id, roleId: a.id },
      { userId: target.id, roleId: b.id },
    ]);
    await db.source.getRepository(RolePermissionEntity).insert([
      { roleId: a.id, permissionId: read.id },
      { roleId: b.id, permissionId: read.id },
    ]);
    await db.source
      .getRepository(UserPermissionEntity)
      .insert({ userId: target.id, permissionId: read.id });
    await del(`users/${target.id}/permissions/${read.id}`, actor).expect(204);
    await get('authorization/users', target).expect(200);
    await del(`roles/${a.id}/permissions/${read.id}`, actor).expect(204);
    await get('authorization/users', target).expect(200);
    await del(`roles/${b.id}/permissions/${read.id}`, actor).expect(204);
    await get('authorization/users', target).expect(403);
  });

  it('rolls back changes that would remove the last eligible delegation manager', async () => {
    const actor = await admin();
    const delegate = await permission('roles.delegate');
    await del(`users/${actor.id}/permissions/${delegate.id}`, actor).expect(409);
    const authority = await app.get(AuthorizationService).authority(actor.id);
    expect(authority.permissions).toContain('roles.delegate');
    await api()
      .patch(`/api/v1/authorization/users/${actor.id}/status`)
      .set('Origin', origin)
      .auth(actor.token, { type: 'bearer' })
      .send({ status: 'inactive' })
      .expect(409);
    expect(
      (await db.source.getRepository(UserEntity).findOneByOrFail({ id: actor.id })).status,
    ).toBe('active');
  });

  it('serializes competing manager revocations and preserves one recovery manager', async () => {
    const one = await admin();
    const two = await admin();
    const delegate = await permission('roles.delegate');
    const results = await Promise.all([
      del(`users/${one.id}/permissions/${delegate.id}`, one),
      del(`users/${two.id}/permissions/${delegate.id}`, two),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([204, 409]);
  });

  it('rechecks actor authority and session inside mutations after a previously passed guard', async () => {
    const actor = await admin();
    const target = await identity();
    const read = await permission('users.read');
    const assign = await permission('permissions.assign');
    await db.source
      .getRepository(UserPermissionEntity)
      .delete({ userId: actor.id, permissionId: assign.id });
    await expect(
      app.get(AuthorizationService).directPermission(actor.principal, target.id, read.id, true),
    ).rejects.toThrow('Insufficient permission');
    await db.source
      .getRepository(SessionEntity)
      .update({ id: actor.principal.sessionId }, { revokedAt: new Date() });
    await expect(
      app.get(AuthorizationService).createRole(actor.principal, 'late-role'),
    ).rejects.toThrow('Authentication required');
  });

  it('administratively suspends/restores and unlocks scoped users without reviving old sessions', async () => {
    const actor = await admin();
    const target = await identity();
    await api()
      .patch(`/api/v1/authorization/users/${target.id}/status`)
      .set('Origin', origin)
      .auth(actor.token, { type: 'bearer' })
      .send({ status: 'inactive' })
      .expect(204);
    expect(
      await db.source.getRepository(UserEntity).findOneByOrFail({ id: target.id }),
    ).toMatchObject({ status: 'inactive', deactivationSource: 'administrative' });
    await get('policy-fixture/self', target).expect(401);
    await db.source
      .getRepository(UserEntity)
      .update(
        { id: target.id },
        { lockedUntil: new Date(Date.now() + 60000), failedLoginAttempts: 5 },
      );
    await api()
      .patch(`/api/v1/authorization/users/${target.id}/status`)
      .set('Origin', origin)
      .auth(actor.token, { type: 'bearer' })
      .send({ status: 'active' })
      .expect(204);
    expect(
      (await db.source.getRepository(UserEntity).findOneByOrFail({ id: target.id })).lockedUntil,
    ).not.toBeNull();
    await get('policy-fixture/self', target).expect(401);
    await db.source
      .getRepository(UserEntity)
      .update(
        { id: target.id },
        { lockedUntil: new Date(Date.now() + 60000), failedLoginAttempts: 5 },
      );
    await post(`users/${target.id}/unlock`, actor).expect(204);
    expect(
      await db.source.getRepository(UserEntity).findOneByOrFail({ id: target.id }),
    ).toMatchObject({ lockedUntil: null, failedLoginAttempts: 0 });
    expect(await db.source.getRepository(MailOutboxEntity).count()).toBe(2);
  });

  it('validates IDs/sort/body fields, enforces Origin and never returns credential entities', async () => {
    const actor = await admin();
    await get('authorization/users?sortBy=passwordHash', actor).expect(400);
    await get('authorization/roles/not-a-uuid', actor).expect(400);
    await api()
      .post('/api/v1/authorization/roles')
      .auth(actor.token, { type: 'bearer' })
      .send({ name: 'no-origin' })
      .expect(403);
    await post('roles', actor, { name: 'bad name', passwordHash: 'SECRET' }).expect(400);
    const users = await get('authorization/users', actor).expect(200);
    expect(JSON.stringify(users.body)).not.toMatch(
      /passwordHash|password_hash|fixture-not-a-login-password/,
    );
    const spec = await api().get('/docs/openapi.json').expect(200);
    expect(spec.body).toHaveProperty('paths./api/v1/authorization/roles');
    await get(`authorization/users/${randomUUID()}/authority`, actor).expect(404);
  });
});
