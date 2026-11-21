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
import { ArgonPasswordHasher } from '../../src/features/auth/crypto/argon-password-hasher';
const origin = 'https://app.example.com';
describe('Admin seed and portal login', () => {
  let db: DatabaseHarness, app: NestExpressApplication;
  beforeAll(async () => {
    db = await DatabaseHarness.create();
  });
  beforeEach(async () => {
    await db.reset();
    app = await createTestApplication([], {}, await new DataSource(db.source.options).initialize());
  });
  afterEach(async () => {
    if (app) await app.close();
  });
  afterAll(async () => {
    if (db) await db.close();
  });
  const seed = () => seedAdmin(db.source, { ...developmentAdmin, environment: 'development' });
  const login = (
    admin = true,
    email: string = developmentAdmin.email,
    password: string = developmentAdmin.password,
  ) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/' + (admin ? 'admin/login' : 'login'))
      .set('Origin', origin)
      .send({ email, password });
  it('seeds a verified admin idempotently without resetting its password', async () => {
    const id = await seed();
    await seedAdmin(db.source, {
      email: developmentAdmin.email,
      password: 'Different-password-123!',
      environment: 'development',
    });
    expect(await db.source.getRepository(UserEntity).count()).toBe(1);
    expect(
      (await db.source.getRepository(UserEntity).findOneByOrFail({ id })).emailVerifiedAt,
    ).toBeTruthy();
    await login().expect(200);
    await login(true, developmentAdmin.email, 'Different-password-123!').expect(401);
  });
  it('uses the same real cookie/session contracts for admin and ordinary login', async () => {
    await seed();
    const admin = await login().expect(200);
    expect(admin.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('HttpOnly')]),
    );
    expect(admin.body as unknown).not.toHaveProperty('refreshToken');
    await login(false).expect(200);
  });
  it('rejects admin login without admin.access even for a claimed admin userType', async () => {
    const user = await db.source.getRepository(UserEntity).save({
      email: 'ordinary@example.com',
      passwordHash: await new ArgonPasswordHasher().hash('Ordinary-password-123!'),
      userType: 'admin',
      emailVerifiedAt: new Date(),
    });
    await login(true, user.email, 'Ordinary-password-123!').expect(401);
    expect(await db.source.getRepository(SessionEntity).count()).toBe(0);
    await login(false, user.email, 'Ordinary-password-123!').expect(200);
  });
  it('checks live admin permission again on the next login', async () => {
    const id = await seed();
    await login().expect(200);
    const permission = await db.source
      .getRepository(PermissionEntity)
      .findOneByOrFail({ name: 'admin.access' });
    await db.source
      .getRepository(UserPermissionEntity)
      .delete({ userId: id, permissionId: permission.id });
    await login().expect(401);
  });
  it('does not promote existing customers or accept development defaults in production', async () => {
    await db.source
      .getRepository(UserEntity)
      .save({ email: developmentAdmin.email, passwordHash: 'fixture' });
    await expect(seed()).rejects.toMatchObject({ status: 409 });
    expect(await db.source.getRepository(PermissionEntity).count()).toBe(0);
    await expect(
      seedAdmin(db.source, { ...developmentAdmin, environment: 'production' }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('never revives an archived seed identity', async () => {
    const id = await seed();
    await db.source.getRepository(UserEntity).softDelete(id);
    await expect(seed()).rejects.toMatchObject({ status: 409 });
    await login().expect(401);
  });
});
