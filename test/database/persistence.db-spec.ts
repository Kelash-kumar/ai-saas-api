import { randomUUID, createHash } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { DataSource, QueryFailedError } from 'typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { TypeormUsersRepository } from '../../src/features/users/repositories/typeorm-users.repository';
import { UserEntity } from '../../src/features/users/entities/user.entity';
import { RolesRepository } from '../../src/features/authorization/repositories/roles.repository';
import { PermissionsRepository } from '../../src/features/authorization/repositories/permissions.repository';
import { SessionsRepository } from '../../src/features/sessions/repositories/sessions.repository';
import { UserRoleEntity } from '../../src/features/authorization/entities/user-role.entity';
import { RolePermissionEntity } from '../../src/features/authorization/entities/role-permission.entity';
import { UserPermissionEntity } from '../../src/features/authorization/entities/user-permission.entity';
import { RefreshTokenEntity } from '../../src/features/sessions/entities/refresh-token.entity';
import { PasswordResetTokenEntity } from '../../src/features/auth/entities/password-reset-token.entity';
import { EmailVerificationTokenEntity } from '../../src/features/auth/entities/email-verification-token.entity';
import { MailOutboxEntity } from '../../src/features/notifications/entities/mail-outbox.entity';
import { UnitOfWork } from '../../src/core/database/unit-of-work';
import { PageQueryDto } from '../../src/common/pagination/page-query.dto';
import { createTestApplication } from '../support/test-application';
import { DatabaseHarness } from './database-harness';

const digest = () => createHash('sha256').update(randomUUID()).digest('hex');
const future = () => new Date(Date.now() + 3600000);
const page = (input: Partial<PageQueryDto> = {}) => plainToInstance(PageQueryDto, input);

describe('PostgreSQL persistence', () => {
  let db: DatabaseHarness;
  let users: TypeormUsersRepository;
  let roles: RolesRepository;
  beforeAll(async () => {
    db = await DatabaseHarness.create();
    users = new TypeormUsersRepository(db.source.manager);
    roles = new RolesRepository(db.source.manager);
  });
  beforeEach(async () => {
    await db.reset();
  });
  afterAll(async () => {
    if (db) await db.close();
  });

  const createUser = (email = 'ada@example.com') =>
    users.createUser({ email, passwordHash: 'test-only-placeholder-hash' });

  it('applies from empty DB, rolls all migrations back, reapplies, and matches entity metadata', async () => {
    expect(await db.source.showMigrations()).toBe(false);
    expect(await db.source.runMigrations()).toHaveLength(0);
    const migrationCount = db.source.migrations.length;
    for (let i = 0; i < migrationCount; i++) await db.source.undoLastMigration();
    const tables: unknown = await db.source.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='users'",
    );
    expect(tables).toEqual([]);
    expect(await db.source.runMigrations()).toHaveLength(migrationCount);
    expect((await db.source.driver.createSchemaBuilder().log()).upQueries).toHaveLength(0);
  });

  it('normalizes email and excludes credentials from standard reads', async () => {
    const user = await createUser('  ADA@Example.COM ');
    expect(user.email).toBe('ada@example.com');
    expect(user.passwordHash).toBeUndefined();
    expect((await users.findByEmail('ADA@example.com'))?.id).toBe(user.id);
    expect((await users.findCredentials(user.email))?.passwordHash).toBe(
      'test-only-placeholder-hash',
    );
    expect((await users.findById(user.id))?.passwordHash).toBeUndefined();
  });

  it('enforces email normalization even for writes bypassing the repository', async () => {
    await expect(
      db.source
        .getRepository(UserEntity)
        .insert({ email: 'UPPER@example.com', passwordHash: 'hash' }),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
  });

  it('resolves duplicate concurrent registrations with one winner and a safe conflict', async () => {
    const results = await Promise.allSettled([createUser(), createUser('ADA@EXAMPLE.COM')]);
    expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((value) => value.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { response: { code: 'RESOURCE_CONFLICT' } } });
    expect(await users.count()).toBe(1);
  });

  it('create rejects duplicate IDs instead of silently updating existing rows', async () => {
    const role = await roles.create({ name: 'original' });
    await expect(roles.create({ id: role.id, name: 'replacement' })).rejects.toMatchObject({
      response: { code: 'RESOURCE_CONFLICT' },
    });
    expect((await roles.findById(role.id))?.name).toBe('original');
  });

  it('does not silently omit undefined lookup criteria', async () => {
    await createUser();
    await expect(users.exists({ email: undefined })).rejects.toThrow();
  });

  it('reuses bounded CRUD, exists, count, and returns null/false for missing records', async () => {
    const user = await createUser();
    expect(await users.exists({ email: user.email })).toBe(true);
    expect(await users.findAll()).toHaveLength(1);
    expect(await users.update(user.id, { status: 'inactive' })).toMatchObject({
      status: 'inactive',
    });
    expect(await users.findById(randomUUID())).toBeNull();
    expect(await users.update(randomUUID(), { status: 'inactive' })).toBeNull();
    expect(await users.delete(user.id)).toBe(true);
    expect(await users.delete(user.id)).toBe(false);
    expect(await users.count()).toBe(0);
  });

  it('paginates, filters, searches literally and sorts deterministically', async () => {
    for (const email of [
      'c@example.com',
      'a@example.com',
      'b@example.com',
      'literal_%@example.com',
    ])
      await createUser(email);
    const middle = await users.list(page({ page: 2, limit: 2, sortBy: 'email', sortOrder: 'asc' }));
    expect(middle.data.map((row) => row.email)).toEqual(['c@example.com', 'literal_%@example.com']);
    expect(middle.meta).toMatchObject({
      total: 4,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect((await users.list(page({ search: '_%' }))).data).toHaveLength(1);
    expect((await users.list(page(), { status: 'inactive' })).meta.total).toBe(0);
    expect((await users.list(page({ search: "' OR 1=1 --" }))).meta.total).toBe(0);
    const first = await users.list(page({ sortBy: 'createdAt', sortOrder: 'asc' }));
    const repeat = await users.list(page({ sortBy: 'createdAt', sortOrder: 'asc' }));
    expect(first.data.map((row) => row.id)).toEqual(repeat.data.map((row) => row.id));
    expect((await users.list(page({ page: 100 }))).data).toEqual([]);
  });

  it('rejects credential sorting and invalid limits at the persistence boundary', () => {
    expect(() => users.list(page({ sortBy: 'passwordHash' }))).toThrow('Unsupported sort field');
    expect(() => users.list(page({ limit: 101 }))).toThrow('Invalid pagination');
    expect(() => users.findAll({}, 101)).toThrow('Invalid result limit');
    expect(() => users.findOne({})).toThrow('Lookup criteria');
  });

  it('commits and rolls back changes across repositories without leaking a transaction manager', async () => {
    const work = new UnitOfWork(db.source);
    await expect(
      work.run(async (scope) => {
        await scope
          .get(TypeormUsersRepository)
          .createUser({ email: 'rollback@example.com', passwordHash: 'hash' });
        await scope.get(RolesRepository).create({ name: 'rollback-role' });
        throw new Error('Abort');
      }),
    ).rejects.toThrow('Abort');
    expect(await users.count()).toBe(0);
    expect(await roles.count()).toBe(0);
    const escaped = await work.run(async (scope) => {
      const repository = scope.get(RolesRepository);
      await repository.create({ name: 'committed-role' });
      return repository;
    });
    expect(await roles.count()).toBe(1);
    await expect(escaped.count()).rejects.toThrow('outside its active transaction');
  });

  it('stores multiple roles, role permissions, direct permissions and cascades user-owned data', async () => {
    const user = await createUser();
    const roleA = await roles.create({ name: 'employee' });
    const roleB = await roles.create({ name: 'reporter' });
    const permissions = new PermissionsRepository(db.source.manager);
    const permission = await permissions.create({ resource: 'users', action: 'read' });
    expect((await permissions.findById(permission.id))?.name).toBe('users.read');
    await db.source.getRepository(UserRoleEntity).insert([
      { userId: user.id, roleId: roleA.id },
      { userId: user.id, roleId: roleB.id },
    ]);
    await db.source
      .getRepository(RolePermissionEntity)
      .insert({ roleId: roleA.id, permissionId: permission.id });
    await db.source
      .getRepository(UserPermissionEntity)
      .insert({ userId: user.id, permissionId: permission.id });
    await expect(
      db.source.getRepository(UserRoleEntity).insert({ userId: user.id, roleId: roleA.id }),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    const session = await new SessionsRepository(db.source.manager).create({
      userId: user.id,
      expiresAt: future(),
    });
    await db.source
      .getRepository(RefreshTokenEntity)
      .save({ sessionId: session.id, tokenDigest: digest(), expiresAt: future() });
    await users.delete(user.id);
    expect(await db.source.getRepository(UserRoleEntity).count()).toBe(0);
    expect(await db.source.getRepository(UserPermissionEntity).count()).toBe(0);
    expect(await db.source.getRepository(RefreshTokenEntity).count()).toBe(0);
    expect(await roles.count()).toBe(2);
  });

  it('rejects orphan relationships with sanitized reference errors', async () => {
    await expect(
      new SessionsRepository(db.source.manager).create({
        userId: randomUUID(),
        expiresAt: future(),
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_REFERENCE' } });
  });

  it('enforces an acyclic hierarchy including concurrent opposite edges', async () => {
    const a = await roles.create({ name: 'a' });
    const b = await roles.create({ name: 'b' });
    const c = await roles.create({ name: 'c' });
    await roles.inherit(a.id, b.id);
    await roles.inherit(b.id, c.id);
    await expect(roles.inherit(c.id, a.id)).rejects.toMatchObject({
      response: { code: 'INVALID_DATA' },
    });
    await expect(roles.inherit(a.id, a.id)).rejects.toMatchObject({
      response: { code: 'INVALID_DATA' },
    });
    await db.source.query('DELETE FROM role_inheritance');
    const results = await Promise.allSettled([
      roles.inherit(a.id, b.id),
      roles.inherit(b.id, a.id),
    ]);
    expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
  });

  it('rejects cycle-forming hierarchy updates and stale-snapshot isolation levels', async () => {
    const a = await roles.create({ name: 'a' });
    const b = await roles.create({ name: 'b' });
    const c = await roles.create({ name: 'c' });
    await roles.inherit(a.id, b.id);
    await roles.inherit(b.id, c.id);
    await expect(
      db.source.query('UPDATE role_inheritance SET inherited_role_id=$1 WHERE role_id=$2', [
        a.id,
        b.id,
      ]),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
    await expect(
      db.source.transaction('REPEATABLE READ', async (manager) => {
        await new RolesRepository(manager).inherit(c.id, a.id);
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_DATA' } });
  });

  it('enforces token digest, expiry, single-successor and same-session lineage constraints', async () => {
    const user = await createUser();
    const sessions = new SessionsRepository(db.source.manager);
    const session = await sessions.create({ userId: user.id, expiresAt: future() });
    const other = await sessions.create({ userId: user.id, expiresAt: future() });
    const tokens = db.source.getRepository(RefreshTokenEntity);
    const parent = await tokens.save({
      sessionId: session.id,
      tokenDigest: digest(),
      expiresAt: future(),
    });
    await expect(
      tokens.insert({
        sessionId: other.id,
        parentId: parent.id,
        tokenDigest: digest(),
        expiresAt: future(),
      }),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        tokens.insert({
          sessionId: session.id,
          parentId: parent.id,
          tokenDigest: digest(),
          expiresAt: future(),
        }),
      ),
    );
    expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect((await tokens.findOneByOrFail({ id: parent.id })).tokenDigest).toBeUndefined();
    await expect(
      tokens.insert({ sessionId: session.id, tokenDigest: 'plaintext', expiresAt: future() }),
    ).rejects.toBeInstanceOf(QueryFailedError);
    await expect(
      tokens.insert({ sessionId: session.id, tokenDigest: digest(), expiresAt: new Date(0) }),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('keeps reset/verification tokens purpose-bound and hides outbox payloads', async () => {
    const user = await createUser();
    const value = digest();
    for (const target of [PasswordResetTokenEntity, EmailVerificationTokenEntity]) {
      const repository = db.source.getRepository(target);
      const token = await repository.save({
        userId: user.id,
        tokenDigest: value,
        expiresAt: future(),
      });
      expect((await repository.findOneByOrFail({ id: token.id })).tokenDigest).toBeUndefined();
      await expect(
        repository.insert({ userId: user.id, tokenDigest: value, expiresAt: future() }),
      ).rejects.toMatchObject({ driverError: { code: '23505' } });
    }
    const outbox = db.source.getRepository(MailOutboxEntity);
    const mail = await outbox.save({
      recipient: user.email,
      template: 'verify',
      payloadCiphertext: Buffer.from('test-ciphertext'),
      keyId: 'test-key',
    });
    const found = await outbox.findOneByOrFail({ id: mail.id });
    expect(found.payloadCiphertext).toBeUndefined();
    expect(found.recipient).toBeUndefined();
  });

  it('bounds database statements and keeps the pool usable after rollback', async () => {
    await expect(
      db.source.transaction(async (manager) => {
        await manager.query("SET LOCAL statement_timeout = '50ms'");
        await manager.query('SELECT pg_sleep(0.2)');
      }),
    ).rejects.toMatchObject({ driverError: { code: '57014' } });
    expect(await users.count()).toBe(0);
  });
});

describe('Real database readiness', () => {
  let db: DatabaseHarness;
  let app: NestExpressApplication;
  beforeAll(async () => {
    db = await DatabaseHarness.create();
    app = await createTestApplication([], {}, db.source);
  });
  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.close();
  });
  it('checks the database, reports 503 on database loss, and retains independent liveness', async () => {
    const api = request(app.getHttpServer());
    expect((await api.get('/api/v1/health/ready').expect(200)).body).toMatchObject({
      info: { database: { status: 'up' } },
    });
    await app.get(DataSource).destroy();
    const down = await api.get('/api/v1/health/ready').expect(503);
    expect(JSON.stringify(down.body)).not.toContain('password');
    await api.get('/api/v1/health/live').expect(200);
  });
});
