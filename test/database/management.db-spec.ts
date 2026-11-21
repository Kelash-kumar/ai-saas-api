import { randomUUID } from 'node:crypto';
import { DataSource, IsNull } from 'typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DatabaseHarness } from './database-harness';
import { createTestApplication } from '../support/test-application';
import { UserEntity } from '../../src/features/users/entities/user.entity';
import { CompanyEntity } from '../../src/features/companies/entities/company.entity';
import { SessionEntity } from '../../src/features/sessions/entities/session.entity';
import { UserPermissionEntity } from '../../src/features/authorization/entities/user-permission.entity';
import { PermissionEntity } from '../../src/features/authorization/entities/permission.entity';
import { MailOutboxEntity } from '../../src/features/notifications/entities/mail-outbox.entity';
import { PasswordResetTokenEntity } from '../../src/features/auth/entities/password-reset-token.entity';
import { AccessTokenService } from '../../src/features/auth/crypto/access-token.service';
import { PASSWORD_HASHER } from '../../src/features/auth/interfaces/auth.types';
import type { PasswordHasher } from '../../src/features/auth/interfaces/auth.types';
import { operatorGrant } from '../../src/features/authorization/bootstrap';
import { EncryptedMessages } from '../../src/features/notifications/encrypted-messages';
import { UserManagementService } from '../../src/features/users/user-management.service';
function envelope(response: request.Response) {
  return response.body as {
    data: { id: string; firstName: string };
    meta: { total: number };
    paths: Record<string, Record<string, unknown>>;
  };
}
const origin = 'https://app.example.com';
describe('User and company management', () => {
  let db: DatabaseHarness;
  let app: NestExpressApplication;
  beforeAll(async () => {
    db = await DatabaseHarness.create();
  });
  beforeEach(async () => {
    await db.reset();
    app = await createTestApplication(
      [],
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
  async function identity(bootstrap = false) {
    const user = await db.source.getRepository(UserEntity).save({
      email: randomUUID() + '@example.com',
      passwordHash: 'fixture-no-login',
      emailVerifiedAt: new Date(),
    });
    const session = await db.source
      .getRepository(SessionEntity)
      .save({ userId: user.id, expiresAt: new Date(Date.now() + 3600000) });
    const token = await app.get(AccessTokenService).sign(user.id, session.id, 900);
    if (bootstrap) await operatorGrant(db.source, user.email, true);
    return {
      user,
      session,
      token,
      principal: {
        userId: user.id,
        sessionId: session.id,
        email: user.email,
        userType: 'customer',
      },
    };
  }
  type Actor = Awaited<ReturnType<typeof identity>>;
  const api = () => request(app.getHttpServer());
  const get = (path: string, a: Actor) =>
    api()
      .get('/api/v1/' + path)
      .auth(a.token, { type: 'bearer' });
  const post = (path: string, a: Actor, body: object) =>
    api()
      .post('/api/v1/' + path)
      .auth(a.token, { type: 'bearer' })
      .set('Origin', origin)
      .send(body);
  const patch = (path: string, a: Actor, body: object) =>
    api()
      .patch('/api/v1/' + path)
      .auth(a.token, { type: 'bearer' })
      .set('Origin', origin)
      .send(body);
  const del = (path: string, a: Actor) =>
    api()
      .delete('/api/v1/' + path)
      .auth(a.token, { type: 'bearer' })
      .set('Origin', origin);
  const input = (extra: object = {}) => ({
    email: 'managed@example.com',
    password: 'Managed-password-123!',
    firstName: 'Ada',
    lastName: 'Lovelace',
    ...extra,
  });
  async function give(a: Actor, name: string) {
    const p = await db.source.getRepository(PermissionEntity).findOneByOrFail({ name });
    await db.source
      .getRepository(UserPermissionEntity)
      .insert({ userId: a.user.id, permissionId: p.id });
  }
  it('denies missing bearer, ordinary identities, and wrong origins', async () => {
    await api().get('/api/v1/companies').expect(401);
    const actor = await identity();
    await get('companies', actor).expect(403);
    await get('users', actor).expect(403);
    const admin = await identity(true);
    await api()
      .post('/api/v1/companies')
      .auth(admin.token, { type: 'bearer' })
      .send({ name: 'Acme' })
      .expect(403);
  });
  it('creates, lists, updates and deletes companies with safe projections and headers', async () => {
    const a = await identity(true);
    const created = await post('companies', a, {
      name: ' Acme ',
      email: ' OFFICE@ACME.TEST ',
      website: 'https://example.com',
    }).expect(201);
    const row = envelope(created).data;
    expect(created.headers['cache-control']).toBe('no-store');
    expect(envelope(created).data).toMatchObject({ name: 'Acme', email: 'office@acme.test' });
    await get('companies/' + row.id, a).expect(200);
    const list = await get('companies?search=acme&sortBy=name&limit=1', a).expect(200);
    expect(envelope(list).meta.total).toBe(1);
    await patch('companies/' + row.id, a, { name: 'Renamed', email: null }).expect(200);
    await del('companies/' + row.id, a).expect(204);
    await get('companies/' + row.id, a).expect(404);
  });
  it('provisions users with the existing hash and transactional verification flow', async () => {
    const a = await identity(true);
    const company = await db.source.getRepository(CompanyEntity).save({ name: 'Acme' });
    const response = await post(
      'users',
      a,
      input({ email: ' MANAGED@EXAMPLE.COM ', companyId: company.id }),
    ).expect(201);
    const id = envelope(response).data.id;
    expect(envelope(response).data).toMatchObject({
      email: 'managed@example.com',
      emailVerifiedAt: null,
      companyId: company.id,
    });
    expect(envelope(response).data).not.toHaveProperty('passwordHash');
    expect(envelope(response).data).not.toHaveProperty('password');
    const user = await db.source
      .getRepository(UserEntity)
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id=:id', { id })
      .getOneOrFail();
    expect(
      await app.get<PasswordHasher>(PASSWORD_HASHER).verify(user.passwordHash, input().password),
    ).toBe(true);
    await api()
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: user.email, password: input().password })
      .expect(401);
    const mail = await db.source
      .getRepository(MailOutboxEntity)
      .createQueryBuilder('m')
      .addSelect(['m.recipient', 'm.payloadCiphertext'])
      .getOneOrFail();
    const token = app
      .get(EncryptedMessages)
      .open(mail.template, mail.recipient, mail.keyId, mail.payloadCiphertext).token;
    await api().post('/api/v1/auth/verify-email').set('Origin', origin).send({ token }).expect(204);
    await api()
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: user.email, password: input().password })
      .expect(200);
    await patch('users/' + id, a, { firstName: 'Grace', companyId: null }).expect(200);
    expect(envelope(await get('users/' + id, a).expect(200)).data.firstName).toBe('Grace');
  });
  it('preserves strict validation, immutable email/credentials and database constraints', async () => {
    const a = await identity(true);
    await post('companies', a, { name: null }).expect(400);
    await post('companies', a, { name: 'A', website: 'javascript:alert(1)' }).expect(400);
    await post('users', a, input({ companyId: randomUUID() })).expect(404);
    await post('users', a, input({ userType: 'administrator' })).expect(400);
    const user = envelope(await post('users', a, input()).expect(201)).data;
    await post('users', a, input()).expect(409);
    await patch('users/' + user.id, a, { email: 'changed@example.com' }).expect(400);
    await patch('users/' + user.id, a, { password: 'Another-password-123' }).expect(400);
    await patch('users/' + user.id, a, { firstName: null }).expect(400);
    await get('users?sortBy=passwordHash', a).expect(400);
    await get('companies?limit=10000', a).expect(400);
    await get('companies/not-a-uuid', a).expect(400);
    await get('users/' + randomUUID(), a).expect(404);
    expect(await db.source.getRepository(MailOutboxEntity).count()).toBe(1);
  });
  it('paginates literal search and company filters through shared repository code', async () => {
    const a = await identity(true);
    const c = await db.source.getRepository(CompanyEntity).save({ name: '100%_Corp' });
    await post('users', a, input({ companyId: c.id })).expect(201);
    await post('users', a, input({ email: 'other@example.com', firstName: 'Grace' })).expect(201);
    expect(envelope(await get('users?companyId=' + c.id, a).expect(200)).meta.total).toBe(1);
    expect(envelope(await get('users?search=Grace&limit=1', a).expect(200)).meta.total).toBe(1);
    expect(
      envelope(await get('companies?search=' + encodeURIComponent('%_'), a).expect(200)).meta.total,
    ).toBe(1);
    expect(
      envelope(await get('users?search=' + encodeURIComponent('%_'), a).expect(200)).meta.total,
    ).toBe(0);
  });
  it('blocks company deletion for live and archived linked users without cascades', async () => {
    const a = await identity(true);
    const c = await db.source.getRepository(CompanyEntity).save({ name: 'Retained' });
    const u = await db.source
      .getRepository(UserEntity)
      .save({ email: 'linked@example.com', passwordHash: 'fixture', companyId: c.id });
    await del('companies/' + c.id, a).expect(409);
    await del('users/' + u.id, a).expect(204);
    await del('companies/' + c.id, a).expect(409);
    expect(await db.source.getRepository(CompanyEntity).count()).toBe(1);
    await expect(db.source.getRepository(CompanyEntity).delete(c.id)).rejects.toMatchObject({
      driverError: { code: '23503' },
    });
  });
  it('archives users, revokes sessions/recovery, reserves email and denies reactivation', async () => {
    const a = await identity(true);
    const target = await identity();
    await db.source.getRepository(PasswordResetTokenEntity).insert({
      userId: target.user.id,
      tokenDigest: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 3600000),
    });
    await del('users/' + target.user.id, a).expect(204);
    expect(await db.source.getRepository(UserEntity).findOneBy({ id: target.user.id })).toBeNull();
    const archived = await db.source
      .getRepository(UserEntity)
      .findOneOrFail({ where: { id: target.user.id }, withDeleted: true });
    expect(archived.deletedAt).toBeInstanceOf(Date);
    expect(
      (await db.source.getRepository(SessionEntity).findOneByOrFail({ id: target.session.id }))
        .revokedAt,
    ).toBeTruthy();
    expect(
      await db.source
        .getRepository(PasswordResetTokenEntity)
        .countBy({ userId: target.user.id, consumedAt: IsNull() }),
    ).toBe(0);
    await get('auth/me', target).expect(401);
    await get('users/' + target.user.id, a).expect(404);
    await patch('authorization/users/' + target.user.id + '/status', a, {
      status: 'active',
    }).expect(404);
    await post('users', a, input({ email: target.user.email })).expect(409);
  });
  it('does not let users.update or users.delete affect subjects above the actor grant ceiling', async () => {
    const admin = await identity(true),
      limited = await identity();
    await give(limited, 'users.update');
    await give(limited, 'users.delete');
    await patch('users/' + admin.user.id, limited, { firstName: 'Blocked' }).expect(403);
    await del('users/' + admin.user.id, limited).expect(403);
    expect(
      (await db.source.getRepository(UserEntity).findOneByOrFail({ id: admin.user.id })).firstName,
    ).toBeNull();
  });
  it('rolls back archival of the last recovery manager and rechecks mutation permissions', async () => {
    const a = await identity(true);
    await del('users/' + a.user.id, a).expect(409);
    expect(
      (await db.source.getRepository(SessionEntity).findOneByOrFail({ id: a.session.id }))
        .revokedAt,
    ).toBeNull();
    const target = await identity();
    const permission = await db.source
      .getRepository(PermissionEntity)
      .findOneByOrFail({ name: 'users.update' });
    await db.source
      .getRepository(UserPermissionEntity)
      .delete({ userId: a.user.id, permissionId: permission.id });
    await expect(
      app.get(UserManagementService).update(a.principal, target.user.id, { firstName: 'Denied' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('documents all management paths and hides profile fields on existing auth principal', async () => {
    const a = await identity(true);
    const spec = await api().get('/docs/openapi.json').expect(200);
    expect(envelope(spec).paths['/api/v1/companies/{id}']?.delete).toBeDefined();
    expect(envelope(spec).paths['/api/v1/users']?.post).toBeDefined();
    const me = await get('auth/me', a).expect(200);
    expect(envelope(me).data).not.toHaveProperty('companyId');
  });
});
