import { DataSource } from 'typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DatabaseHarness } from './database-harness';
import { createTestApplication } from '../support/test-application';
import { EncryptedMessages } from '../../src/features/notifications/encrypted-messages';
import { MailOutboxEntity } from '../../src/features/notifications/entities/mail-outbox.entity';
import { UserEntity } from '../../src/features/users/entities/user.entity';
import { SessionEntity } from '../../src/features/sessions/entities/session.entity';
import { PasswordResetTokenEntity } from '../../src/features/auth/entities/password-reset-token.entity';
import { AccountActivationTokenEntity } from '../../src/features/auth/entities/account-activation-token.entity';
import { newOpaqueToken, tokenDigest } from '../../src/features/auth/crypto/opaque-token';
import { PasswordRecoveryService } from '../../src/features/auth/services/password-recovery.service';
import { SessionAuthService } from '../../src/features/auth/services/session-auth.service';
import { PasswordConfirmation } from '../../src/features/auth/services/password-confirmation.service';
import { UnitOfWork } from '../../src/core/database/unit-of-work';
import { AuthConfig } from '../../src/core/config/auth-config.service';
import { AppLogger } from '../../src/core/logging/app-logger.service';
import { PASSWORD_HASHER } from '../../src/features/auth/interfaces/auth.types';
import type { PasswordHasher } from '../../src/features/auth/interfaces/auth.types';

const origin = 'https://app.example.com';
const email = 'ada@example.com';
const password = 'The old private passphrase!';
const newPassword = 'The replacement passphrase!';

describe('Recovery and account lifecycle', () => {
  let db: DatabaseHarness;
  let app: NestExpressApplication;
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
  const api = () => request(app.getHttpServer());
  const post = (path: string, body: unknown) =>
    api()
      .post(`/api/v1/auth/${path}`)
      .set('Origin', origin)
      .send(body as object);
  async function token(template: string): Promise<string> {
    const mail = await db.source
      .getRepository(MailOutboxEntity)
      .createQueryBuilder('mail')
      .addSelect(['mail.recipient', 'mail.payloadCiphertext'])
      .where('mail.template = :template', { template })
      .orderBy('mail.createdAt', 'DESC')
      .getOneOrFail();
    const payload = app
      .get(EncryptedMessages)
      .open(mail.template, mail.recipient, mail.keyId, mail.payloadCiphertext);
    if (!payload.token) throw new Error('Missing token');
    return payload.token;
  }
  async function login(secret = password): Promise<string> {
    const response = await post('login', { email, password: secret }).expect(200);
    return (response.body as { data: { accessToken: string } }).data.accessToken;
  }
  async function identity(): Promise<string> {
    await post('register', { email, password }).expect(202);
    await post('verify-email', { token: await token('verify_email') }).expect(204);
    return login();
  }
  const forgot = () => post('forgot-password', { email }).expect(202);
  const reset = (value: string, secret = newPassword) =>
    post('reset-password', { token: value, newPassword: secret });

  it('returns generic forgot responses and enforces a durable cooldown, without changing credentials', async () => {
    await identity();
    const known = await forgot();
    const unknown = await post('forgot-password', { email: 'unknown@example.com' }).expect(202);
    expect(known.body).toEqual(unknown.body);
    await forgot();
    expect(await db.source.getRepository(PasswordResetTokenEntity).count()).toBe(1);
    await login();
    const value = await token('password_reset');
    const stored = await db.source
      .getRepository(PasswordResetTokenEntity)
      .createQueryBuilder('token')
      .addSelect('token.tokenDigest')
      .getOneOrFail();
    expect(stored.tokenDigest).toBe(tokenDigest(value));
    expect(JSON.stringify(known.body)).not.toContain(value);
  });

  it('consumes a reset once, revokes every session, notifies and requires a fresh login', async () => {
    const oldAccess = await identity();
    const otherAccess = await login();
    await forgot();
    const value = await token('password_reset');
    await reset(value).expect(204);
    await reset(value).expect(400);
    for (const access of [oldAccess, otherAccess])
      await api().get('/api/v1/auth/me').auth(access, { type: 'bearer' }).expect(401);
    expect(
      (await db.source.getRepository(SessionEntity).find()).every((row) => row.revokedAt !== null),
    ).toBe(true);
    await post('login', { email, password }).expect(401);
    await login(newPassword);
    expect(
      await db.source.getRepository(MailOutboxEntity).countBy({ template: 'password_changed' }),
    ).toBe(1);
  });

  it('serializes concurrent resets and rejects a verification token in the reset endpoint', async () => {
    await identity();
    await forgot();
    const value = await token('password_reset');
    const results = await Promise.all([reset(value), reset(value)]);
    expect(results.map((response) => response.status).sort()).toEqual([204, 400]);
    await reset(await token('verify_email')).expect(400);
  });

  it('serializes password reset against refresh so no refreshed session survives', async () => {
    await identity();
    await forgot();
    const response = await post('login', { email, password }).expect(200);
    const header: unknown = response.headers['set-cookie'];
    if (!Array.isArray(header) || typeof header[0] !== 'string') throw new Error('Missing cookie');
    const raw = header[0].split(';')[0]?.slice('foundation_refresh='.length);
    if (!raw) throw new Error('Missing refresh credential');
    const results = await Promise.allSettled([
      app.get(SessionAuthService).refresh(raw),
      app.get(PasswordRecoveryService).reset(await token('password_reset'), newPassword),
    ]);
    expect(results[1]?.status).toBe('fulfilled');
    expect(
      (await db.source.getRepository(SessionEntity).find()).every((row) => row.revokedAt !== null),
    ).toBe(true);
    await login(newPassword);
  });

  it('expires tokens and supersedes prior requests without locking accounts for bad reset attempts', async () => {
    await identity();
    await forgot();
    const old = await token('password_reset');
    await db.source.query("UPDATE password_reset_tokens SET created_at=now()-interval '2 minutes'");
    await forgot();
    const current = await token('password_reset');
    expect(current).not.toBe(old);
    await reset(old).expect(400);
    await reset(newOpaqueToken()).expect(400);
    await db.source.query(
      "UPDATE password_reset_tokens SET created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour'",
    );
    await reset(current).expect(400);
    expect(
      (await db.source.getRepository(UserEntity).findOneByOrFail({ email })).failedLoginAttempts,
    ).toBe(0);
  });

  it('allows email recovery of locked verified accounts and clears the lock only when reset completes', async () => {
    await identity();
    for (let i = 0; i < 5; i++) await post('login', { email, password: 'wrong' }).expect(401);
    await forgot();
    expect(
      (await db.source.getRepository(UserEntity).findOneByOrFail({ email })).lockedUntil,
    ).not.toBeNull();
    await reset(await token('password_reset')).expect(204);
    expect(await db.source.getRepository(UserEntity).findOneByOrFail({ email })).toMatchObject({
      lockedUntil: null,
      failedLoginAttempts: 0,
    });
    await login(newPassword);
  });

  it('requires the current password, changes atomically, and invalidates pending reset tokens', async () => {
    const access = await identity();
    await forgot();
    const value = await token('password_reset');
    await post('change-password', { currentPassword: 'wrong', newPassword })
      .auth(access, { type: 'bearer' })
      .expect(401);
    expect(
      (await db.source.getRepository(UserEntity).findOneByOrFail({ email })).failedLoginAttempts,
    ).toBe(1);
    await post('change-password', { currentPassword: password, newPassword })
      .auth(access, { type: 'bearer' })
      .expect(204);
    await reset(value).expect(400);
    await api().get('/api/v1/auth/me').auth(access, { type: 'bearer' }).expect(401);
    await login(newPassword);
  });

  it('persists lockout from repeated incorrect password confirmations', async () => {
    const access = await identity();
    for (let i = 0; i < 5; i++)
      await post('change-password', { currentPassword: 'wrong', newPassword })
        .auth(access, { type: 'bearer' })
        .expect(401);
    const user = await db.source.getRepository(UserEntity).findOneByOrFail({ email });
    expect(user.failedLoginAttempts).toBe(5);
    expect(user.lockedUntil).not.toBeNull();
    await post('login', { email, password }).expect(401);
  });

  it('rolls back password change, token consumption and revocation if notification preparation fails', async () => {
    const access = await identity();
    await forgot();
    const value = await token('password_reset');
    const service = new PasswordRecoveryService(
      new UnitOfWork(db.source),
      app.get(AuthConfig),
      app.get(AppLogger),
      app.get(PasswordConfirmation),
      app.get<PasswordHasher>(PASSWORD_HASHER),
      {
        prepare: () => {
          throw new Error('Queue failed');
        },
      },
    );
    await expect(service.reset(value, newPassword)).rejects.toThrow('Queue failed');
    expect(
      (await db.source.getRepository(PasswordResetTokenEntity).findOneOrFail({ where: {} }))
        .consumedAt,
    ).toBeNull();
    await api().get('/api/v1/auth/me').auth(access, { type: 'bearer' }).expect(200);
    await login();
    await reset(value).expect(204);
  });

  it('deactivates only the current identity and reactivates once without resurrecting sessions', async () => {
    const access = await identity();
    await forgot();
    const resetValue = await token('password_reset');
    await post('deactivate', { currentPassword: 'wrong' })
      .auth(access, { type: 'bearer' })
      .expect(401);
    await post('deactivate', { currentPassword: password })
      .auth(access, { type: 'bearer' })
      .expect(204);
    expect(await db.source.getRepository(UserEntity).findOneByOrFail({ email })).toMatchObject({
      status: 'inactive',
      deactivationSource: 'self',
    });
    await api().get('/api/v1/auth/me').auth(access, { type: 'bearer' }).expect(401);
    await reset(resetValue).expect(400);
    await post('login', { email, password }).expect(401);
    await post('activation/request', { email }).expect(202);
    const value = await token('account_activation');
    const outcomes = await Promise.all([
      post('activate', { token: value }),
      post('activate', { token: value }),
    ]);
    expect(outcomes.map((row) => row.status).sort()).toEqual([204, 400]);
    await api().get('/api/v1/auth/me').auth(access, { type: 'bearer' }).expect(401);
    await login();
    expect(await db.source.getRepository(AccountActivationTokenEntity).count()).toBe(1);
  });

  it('does not override administrative deactivation, including a previously issued activation token', async () => {
    const access = await identity();
    await post('deactivate', { currentPassword: password })
      .auth(access, { type: 'bearer' })
      .expect(204);
    await post('activation/request', { email }).expect(202);
    const value = await token('account_activation');
    await db.source
      .getRepository(UserEntity)
      .update({ email }, { deactivationSource: 'administrative' });
    await post('activate', { token: value }).expect(400);
    const known = await post('activation/request', { email }).expect(202);
    const unknown = await post('activation/request', { email: 'unknown@example.com' }).expect(202);
    expect(known.body).toEqual(unknown.body);
    expect(await db.source.getRepository(AccountActivationTokenEntity).count()).toBe(1);
    await forgot();
    expect(await db.source.getRepository(PasswordResetTokenEntity).count()).toBe(0);
  });

  it('rejects stale confirmation proofs after a concurrent password reset', async () => {
    const access = await identity();
    await forgot();
    const principal = (await api().get('/api/v1/auth/me').auth(access, { type: 'bearer' }))
      .body as { data: { userId: string; sessionId: string; email: string; userType: string } };
    const proof = await app.get(PasswordConfirmation).prepare(principal.data, password);
    await reset(await token('password_reset')).expect(204);
    const accepted = await new UnitOfWork(db.source).run(async (scope) => {
      const { RecoveryRepository } =
        await import('../../src/features/auth/repositories/recovery.repository');
      const repository = scope.get(RecoveryRepository);
      return app
        .get(PasswordConfirmation)
        .accept(
          repository,
          principal.data,
          await repository.lockUser(principal.data.userId),
          proof,
        );
    });
    expect(accepted).toBe(false);
  });

  it('enforces Origin, validation, bearer ownership and public-route limits', async () => {
    await api().post('/api/v1/auth/forgot-password').send({ email }).expect(403);
    await post('reset-password', { token: newOpaqueToken(), newPassword: 'short' }).expect(400);
    await post('deactivate', { currentPassword: password, userId: newOpaqueToken() }).expect(401);
    await post('change-password', { currentPassword: password, newPassword }).expect(401);
    for (let i = 0; i < 2; i++) await post('forgot-password', { email }).expect(202);
    await post('forgot-password', { email }).expect(429);
  });
});
