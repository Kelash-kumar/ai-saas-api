import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DatabaseHarness } from './database-harness';
import { createTestApplication } from '../support/test-application';
import { seedAdmin, developmentAdmin } from '../../src/core/database/seeds/admin.seed';
import { UserEntity } from '../../src/features/users/entities/user.entity';
import { SessionEntity } from '../../src/features/sessions/entities/session.entity';
import { PermissionEntity } from '../../src/features/authorization/entities/permission.entity';
import { UserPermissionEntity } from '../../src/features/authorization/entities/user-permission.entity';
import { MailOutboxEntity } from '../../src/features/notifications/entities/mail-outbox.entity';
import { EncryptedMessages } from '../../src/features/notifications/encrypted-messages';
import { LoginChallengeEntity } from '../../src/features/auth/entities/login-challenge.entity';
const origin = 'https://app.example.com';
function data(response: request.Response) {
  return (response.body as { data: Record<string, unknown> }).data;
}
describe('CRM contracts and email second-factor', () => {
  let db: DatabaseHarness, app: NestExpressApplication, token: string;
  beforeAll(async () => {
    db = await DatabaseHarness.create();
  });
  beforeEach(async () => {
    await db.reset();
    app = await createTestApplication([], {}, await new DataSource(db.source.options).initialize());
    await seedAdmin(db.source, { ...developmentAdmin, environment: 'test' });
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/admin/login')
      .set('Origin', origin)
      .send(developmentAdmin)
      .expect(200);
    token = String(data(response).accessToken);
  });
  afterEach(async () => {
    await app.close();
  });
  afterAll(async () => {
    await db.close();
  });
  const get = (path: string) =>
    request(app.getHttpServer())
      .get('/api/v1/' + path)
      .auth(token, { type: 'bearer' });
  const post = (path: string, body: object) =>
    request(app.getHttpServer())
      .post('/api/v1/' + path)
      .auth(token, { type: 'bearer' })
      .set('Origin', origin)
      .send(body);
  const input = (extra: object = {}) => ({
    email: randomUUID() + '@example.test',
    password: 'Managed-account-password-123!',
    confirmPassword: 'Managed-account-password-123!',
    firstName: 'CRM',
    lastName: 'Member',
    ...extra,
  });
  it('persists account profile, direct grants and company filters without exposing credential data', async () => {
    const company = data(await post('crm/companies', { name: 'Reference company' }).expect(201));
    const permission = await db.source
      .getRepository(PermissionEntity)
      .findOneByOrFail({ name: 'admin.access' });
    const created = data(
      await post(
        'crm/admins',
        input({
          username: 'crm.admin',
          dateOfBirth: '1995-01-02',
          gender: 'male',
          notificationChannel: 'email',
          twoFactor: 'email',
          companyId: company.id,
          permissionIds: [permission.id],
        }),
      ).expect(201),
    );
    expect(created).toMatchObject({
      userType: 'admin',
      username: 'crm.admin',
      dateOfBirth: '1995-01-02',
      gender: 'male',
      notificationChannel: 'email',
      twoFactor: 'email',
    });
    expect(created).not.toHaveProperty('passwordHash');
    const loaded = data(await get('crm/admins/' + String(created.id)).expect(200));
    expect(loaded.permissionIds).toEqual([permission.id]);
    const page = await get(
      'crm/admins?companyId=' +
        String(company.id) +
        '&fromDate=2020-01-01&toDate=2099-01-01&limit=10',
    ).expect(200);
    expect((page.body as { meta: { total: number } }).meta.total).toBe(1);
    await get('crm/users/' + String(created.id)).expect(404);
    await post('crm/users', input({ notificationChannel: 'sms' })).expect(400);
    await post('crm/users', input({ dateOfBirth: '2999-01-01' })).expect(400);
  });
  it('creates and updates a real role permission matrix and enforces matching guards', async () => {
    const permission = await db.source
      .getRepository(PermissionEntity)
      .findOneByOrFail({ name: 'users.read' });
    const role = data(
      await post('crm/roles', {
        name: 'staff',
        guard: 'user',
        permissionIds: [permission.id],
      }).expect(201),
    );
    expect(data(await get('crm/roles/' + String(role.id)).expect(200)).permissionIds).toEqual([
      permission.id,
    ]);
    await post('crm/admins', input({ roleIds: [role.id] })).expect(400);
    const user = data(await post('crm/users', input({ roleIds: [role.id] })).expect(201));
    expect(data(await get('crm/users/' + String(user.id)).expect(200)).roleIds).toEqual([role.id]);
    await request(app.getHttpServer())
      .patch('/api/v1/crm/roles/' + String(role.id))
      .auth(token, { type: 'bearer' })
      .set('Origin', origin)
      .send({ name: 'staff-renamed', guard: 'user', permissionIds: [] })
      .expect(200);
    expect(data(await get('crm/roles/' + String(role.id)).expect(200)).permissionIds).toEqual([]);
  });
  it('archives and restores accounts; rejects a whole mixed selection atomically', async () => {
    const user = data(await post('crm/users', input()).expect(201));
    await post('crm/users/bulk', { action: 'delete', ids: [user.id, randomUUID()] }).expect(404);
    expect(
      (await db.source.getRepository(UserEntity).findOneByOrFail({ id: String(user.id) }))
        .deletedAt,
    ).toBeNull();
    await post('crm/users/bulk', { action: 'delete', ids: [user.id] }).expect(200);
    expect((await get('crm/users?deleted=only').expect(200)).body as unknown).toHaveProperty(
      'meta.total',
      1,
    );
    await post('crm/users/bulk', { action: 'restore', ids: [user.id] }).expect(200);
    expect(
      (await db.source.getRepository(UserEntity).findOneByOrFail({ id: String(user.id) })).status,
    ).toBe('active');
    const admin = await db.source
      .getRepository(UserEntity)
      .findOneByOrFail({ email: developmentAdmin.email });
    await post('crm/admins/bulk', { action: 'delete', ids: [admin.id] }).expect(409);
  });
  it('exports filtered records as escaped CSV and a genuine OOXML ZIP', async () => {
    await post('crm/companies', { name: '=HYPERLINK("bad")' }).expect(201);
    const csv = await get('crm/companies/export?format=csv').expect(200);
    expect(csv.text).toContain("'=HYPERLINK");
    expect(csv.text).not.toContain('password');
    const excel = await get('crm/companies/export?format=xlsx')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const bytes = excel.body as Buffer;
    expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(bytes.includes(Buffer.from('xl/worksheets/sheet1.xml'))).toBe(true);
    expect(bytes.includes(Buffer.from('<f>'))).toBe(false);
  });
  it('enforces export and admin permissions independently of frontend state', async () => {
    const actor = await db.source
      .getRepository(UserEntity)
      .findOneByOrFail({ email: developmentAdmin.email });
    const permissions = await db.source
      .getRepository(PermissionEntity)
      .findBy([{ name: 'admins.read' }, { name: 'companies.export' }]);
    for (const permission of permissions)
      await db.source
        .getRepository(UserPermissionEntity)
        .delete({ userId: actor.id, permissionId: permission.id });
    await get('crm/admins').expect(403);
    await get('crm/companies/export?format=csv').expect(403);
  });
  async function challenge() {
    const user = await db.source
      .getRepository(UserEntity)
      .findOneByOrFail({ email: developmentAdmin.email });
    await db.source.getRepository(UserEntity).update(user.id, { twoFactor: 'email' });
    const before = await db.source.getRepository(SessionEntity).count();
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/admin/login')
      .set('Origin', origin)
      .send(developmentAdmin)
      .expect(200);
    expect(data(login).mfaRequired).toBe(true);
    expect(data(login)).not.toHaveProperty('accessToken');
    expect(await db.source.getRepository(SessionEntity).count()).toBe(before);
    expect(login.headers['set-cookie']).toBeUndefined();
    const mail = await db.source
      .getRepository(MailOutboxEntity)
      .createQueryBuilder('mail')
      .addSelect(['mail.recipient', 'mail.payloadCiphertext'])
      .where({ template: 'login_code' })
      .getOneOrFail();
    const code = app
      .get(EncryptedMessages)
      .open(mail.template, mail.recipient, mail.keyId, mail.payloadCiphertext).token!;
    return { challengeToken: data(login).challengeToken, code };
  }
  it('issues a session only after the emailed code and rejects replay', async () => {
    const proof = await challenge();
    const response = await post('auth/login/verify', proof).expect(200);
    expect(typeof data(response).accessToken).toBe('string');
    await post('auth/login/verify', proof).expect(401);
  });
  it('commits failed second-factor attempts and expires a challenge after five failures', async () => {
    const proof = await challenge();
    const wrong = proof.code === '000000' ? '999999' : '000000';
    for (let attempt = 0; attempt < 5; attempt++)
      await post('auth/login/verify', { ...proof, code: wrong }).expect(401);
    await post('auth/login/verify', proof).expect(401);
    expect((await db.source.getRepository(LoginChallengeEntity).findOneByOrFail({})).attempts).toBe(
      5,
    );
  });
  it('rechecks live admin permission at code completion and rejects expired challenges', async () => {
    const proof = await challenge();
    await db.source
      .getRepository(LoginChallengeEntity)
      .createQueryBuilder()
      .update()
      .set({ expiresAt: new Date(0) })
      .execute();
    await post('auth/login/verify', proof).expect(401);
    const next = await challenge();
    const user = await db.source
        .getRepository(UserEntity)
        .findOneByOrFail({ email: developmentAdmin.email }),
      permission = await db.source
        .getRepository(PermissionEntity)
        .findOneByOrFail({ name: 'admin.access' });
    await db.source
      .getRepository(UserPermissionEntity)
      .delete({ userId: user.id, permissionId: permission.id });
    await post('auth/login/verify', next).expect(401);
  });
  it('logs a managed user in immediately with a custom role while keeping mailbox verification separate', async () => {
    const permission = await db.source
      .getRepository(PermissionEntity)
      .findOneByOrFail({ name: 'users.read' });
    const role = data(
      await post('crm/roles', {
        name: 'custom-reader',
        guard: 'user',
        permissionIds: [permission.id],
      }).expect(201),
    );
    const credentials = input({ roleIds: [role.id] });
    const created = data(await post('crm/users', credentials).expect(201));
    expect(created.emailVerifiedAt).toBeNull();
    expect(created.accessApprovedAt).toBeTruthy();
    const login = await post('auth/login', {
      email: credentials.email,
      password: credentials.password,
    }).expect(200);
    const access = String(data(login).accessToken);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .auth(access, { type: 'bearer' })
      .expect(200);
    expect(
      data(
        await request(app.getHttpServer())
          .get('/api/v1/authorization/me')
          .auth(access, { type: 'bearer' })
          .expect(200),
      ).permissions,
    ).toEqual(['users.read']);
    await post('auth/admin/login', {
      email: credentials.email,
      password: credentials.password,
    }).expect(401);
    await post('auth/login', { email: credentials.email, password: 'Wrong-password-123!' }).expect(
      401,
    );
  });
  it('allows a managed admin with a custom role carrying admin.access to use admin login', async () => {
    const permission = await db.source
      .getRepository(PermissionEntity)
      .findOneByOrFail({ name: 'admin.access' });
    const role = data(
      await post('crm/roles', {
        name: 'custom-admin',
        guard: 'admin',
        permissionIds: [permission.id],
      }).expect(201),
    );
    const credentials = input({ roleIds: [role.id] });
    await post('crm/admins', credentials).expect(201);
    await post('auth/admin/login', {
      email: credentials.email,
      password: credentials.password,
    }).expect(200);
  });
  it('explicitly approves older managed records but leaves public registration gated', async () => {
    const credentials = input();
    const created = data(await post('crm/users', credentials).expect(201));
    await db.source
      .getRepository(UserEntity)
      .update(String(created.id), { accessApprovedAt: null, accessApprovedBy: null });
    await post('auth/login', { email: credentials.email, password: credentials.password }).expect(
      401,
    );
    await request(app.getHttpServer())
      .patch('/api/v1/crm/users/' + String(created.id))
      .auth(token, { type: 'bearer' })
      .set('Origin', origin)
      .send({ allowLogin: true })
      .expect(200);
    await post('auth/login', { email: credentials.email, password: credentials.password }).expect(
      200,
    );
    expect(
      (await db.source.getRepository(UserEntity).findOneByOrFail({ id: String(created.id) }))
        .emailVerifiedAt,
    ).toBeNull();
    const publicCredentials = {
      email: randomUUID() + '@example.test',
      password: 'Public-password-123!',
    };
    await post('auth/register', publicCredentials).expect(202);
    await post('auth/login', publicCredentials).expect(401);
    await post('auth/register', { ...publicCredentials, allowLogin: true }).expect(400);
  });
  it('requires the email second factor on an approved account and verifies mailbox only after a correct code', async () => {
    const credentials = input({ twoFactor: 'email' });
    const created = data(await post('crm/users', credentials).expect(201));
    const login = await post('auth/login', {
      email: credentials.email,
      password: credentials.password,
    }).expect(200);
    expect(data(login).mfaRequired).toBe(true);
    expect(data(login)).not.toHaveProperty('accessToken');
    const mail = await db.source
      .getRepository(MailOutboxEntity)
      .createQueryBuilder('mail')
      .addSelect(['mail.recipient', 'mail.payloadCiphertext'])
      .where({ recipient: credentials.email, template: 'login_code' })
      .getOneOrFail();
    const code = app
      .get(EncryptedMessages)
      .open(mail.template, mail.recipient, mail.keyId, mail.payloadCiphertext).token!;
    await post('auth/login/verify', { challengeToken: data(login).challengeToken, code }).expect(
      200,
    );
    expect(
      (await db.source.getRepository(UserEntity).findOneByOrFail({ id: String(created.id) }))
        .emailVerifiedAt,
    ).toBeTruthy();
  });
});
