import { DataSource } from 'typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Response as TestResponse } from 'supertest';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DatabaseHarness } from './database-harness';
import { createTestApplication } from '../support/test-application';
import { UserEntity } from '../../src/features/users/entities/user.entity';
import { SessionEntity } from '../../src/features/sessions/entities/session.entity';
import { RefreshTokenEntity } from '../../src/features/sessions/entities/refresh-token.entity';
import { EmailVerificationTokenEntity } from '../../src/features/auth/entities/email-verification-token.entity';
import { MailOutboxEntity } from '../../src/features/notifications/entities/mail-outbox.entity';
import { EncryptedVerificationMessage } from '../../src/features/notifications/verification-message.factory';
import { tokenDigest, newOpaqueToken } from '../../src/features/auth/crypto/opaque-token';
import { AccessTokenService } from '../../src/features/auth/crypto/access-token.service';
import { LocalStrategy } from '../../src/features/auth/strategies/local.strategy';
import { SessionAuthService } from '../../src/features/auth/services/session-auth.service';
import { RegistrationService } from '../../src/features/auth/services/registration.service';
import { UnitOfWork } from '../../src/core/database/unit-of-work';
import { AuthConfig } from '../../src/core/config/auth-config.service';
import { AppLogger } from '../../src/core/logging/app-logger.service';
import { PASSWORD_HASHER } from '../../src/features/auth/interfaces/auth.types';
import type { PasswordHasher } from '../../src/features/auth/interfaces/auth.types';
import type { Environment } from '../../src/core/config/environment';
import { validateEnvironment } from '../../src/core/config/environment';
import { testAuthSettings } from '../support/auth-settings';

const origin = 'https://app.example.com';
const password = 'A long private passphrase!';
interface LoginResult {
  accessToken: string;
  csrfToken: string;
  expiresIn: number;
  sessionId: string;
  cookie: string;
}
function result(response: TestResponse): LoginResult {
  const body: unknown = response.body;
  expect(body).toHaveProperty('success', true);
  const data = (body as { data: Omit<LoginResult, 'cookie'> }).data;
  expect(typeof data.accessToken).toBe('string');
  expect(typeof data.csrfToken).toBe('string');
  expect(typeof data.sessionId).toBe('string');
  const header: unknown = response.headers['set-cookie'];
  if (!Array.isArray(header) || typeof header[0] !== 'string')
    throw new Error('Missing session cookie');
  return {
    ...(body as { data: Omit<LoginResult, 'cookie'> }).data,
    cookie: header[0].split(';')[0] ?? '',
  };
}

describe('Authentication HTTP and transaction security', () => {
  let db: DatabaseHarness;
  let app: NestExpressApplication;
  beforeAll(async () => {
    db = await DatabaseHarness.create();
  });
  beforeEach(async () => {
    await db.reset();
    const connection = await new DataSource(db.source.options).initialize();
    try {
      app = await createTestApplication([], { SWAGGER_ENABLED: true }, connection);
    } catch (error) {
      await connection.destroy();
      throw error;
    }
  });
  afterEach(async () => {
    if (app) await app.close();
  });
  afterAll(async () => {
    if (db) await db.close();
  });
  const api = () => request(app.getHttpServer());
  const register = (email = 'ada@example.com') =>
    api().post('/api/v1/auth/register').set('Origin', origin).send({ email, password }).expect(202);
  async function verification(email = 'ada@example.com'): Promise<string> {
    const mail = await db.source
      .getRepository(MailOutboxEntity)
      .createQueryBuilder('mail')
      .addSelect(['mail.recipient', 'mail.payloadCiphertext'])
      .where('mail.recipient = :email', { email })
      .orderBy('mail.createdAt', 'DESC')
      .getOneOrFail();
    return app
      .get(EncryptedVerificationMessage)
      .open(mail.recipient, mail.keyId, mail.payloadCiphertext).token;
  }
  const verify = (token: string) =>
    api().post('/api/v1/auth/verify-email').set('Origin', origin).send({ token });
  async function login(email = 'ada@example.com'): Promise<LoginResult> {
    return result(
      await api()
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email, password, deviceName: 'Test laptop' })
        .expect(200),
    );
  }
  async function identity(email = 'ada@example.com'): Promise<LoginResult> {
    await register(email);
    await verify(await verification(email)).expect(204);
    return login(email);
  }
  const refresh = (session: LoginResult) =>
    api()
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken);
  const logout = (session: LoginResult) =>
    api()
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken);
  const me = (session: LoginResult) =>
    api().get('/api/v1/auth/me').auth(session.accessToken, { type: 'bearer' });

  it('registers with Argon2id and an encrypted verification outbox, without exposing credentials', async () => {
    const response = await register(' ADA@Example.COM ');
    expect(JSON.stringify(response.body)).not.toContain('token');
    const user = await db.source
      .getRepository(UserEntity)
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .getOneOrFail();
    expect(user.email).toBe('ada@example.com');
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    const token = await verification();
    expect(
      (
        await db.source
          .getRepository(EmailVerificationTokenEntity)
          .findOneByOrFail({ userId: user.id })
      ).tokenDigest,
    ).toBeUndefined();
    const stored = await db.source
      .getRepository(EmailVerificationTokenEntity)
      .createQueryBuilder('token')
      .addSelect('token.tokenDigest')
      .getOneOrFail();
    expect(stored.tokenDigest).toBe(tokenDigest(token));
    const mail = await db.source
      .getRepository(MailOutboxEntity)
      .createQueryBuilder('mail')
      .addSelect('mail.payloadCiphertext')
      .getOneOrFail();
    expect(mail.payloadCiphertext.toString()).not.toContain(token);
  });

  it('returns the same generic response for existing email and concurrent registration races', async () => {
    const [one, two] = await Promise.all([register(), register('ADA@example.com')]);
    expect(one.body).toEqual(two.body);
    expect(await db.source.getRepository(UserEntity).count()).toBe(1);
    expect(await db.source.getRepository(MailOutboxEntity).count()).toBe(1);
  });

  it('rolls back registration when preparing its outbox message fails', async () => {
    const settings = new AuthConfig(
      new ConfigService<Environment, true>(
        validateEnvironment({ DATABASE_PASSWORD: 'test-password', ...testAuthSettings }),
      ),
    );
    const service = new RegistrationService(
      new UnitOfWork(db.source),
      settings,
      app.get(AppLogger),
      app.get<PasswordHasher>(PASSWORD_HASHER),
      {
        prepare: () => {
          throw new Error('Queue unavailable');
        },
      },
    );
    await expect(service.register('rollback@example.com', password)).rejects.toThrow(
      'Queue unavailable',
    );
    expect(await db.source.getRepository(UserEntity).count()).toBe(0);
    expect(await db.source.getRepository(EmailVerificationTokenEntity).count()).toBe(0);
  });

  it('requires email verification before login, consumes verification only once under concurrency', async () => {
    await register();
    await api()
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: 'ada@example.com', password })
      .expect(401);
    const token = await verification();
    const results = await Promise.all([verify(token), verify(token)]);
    expect(results.map((response) => response.status).sort()).toEqual([204, 400]);
    await login();
  });

  it('rejects expired and unknown verification tokens', async () => {
    await register();
    const token = await verification();
    await db.source.query(
      "UPDATE email_verification_tokens SET created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour'",
    );
    await verify(token).expect(400);
    await verify(newOpaqueToken()).expect(400);
  });

  it('resends with a generic response and durable per-recipient cooldown', async () => {
    await register();
    await api()
      .post('/api/v1/auth/verification/request')
      .set('Origin', origin)
      .send({ email: 'ada@example.com' })
      .expect(202);
    expect(await db.source.getRepository(MailOutboxEntity).count()).toBe(1);
    await db.source.query(
      "UPDATE email_verification_tokens SET created_at=now()-interval '2 minutes'",
    );
    const known = await api()
      .post('/api/v1/auth/verification/request')
      .set('Origin', origin)
      .send({ email: 'ada@example.com' })
      .expect(202);
    const unknown = await api()
      .post('/api/v1/auth/verification/request')
      .set('Origin', origin)
      .send({ email: 'unknown@example.com' })
      .expect(202);
    expect(known.body).toEqual(unknown.body);
    expect(await db.source.getRepository(MailOutboxEntity).count()).toBe(2);
  });

  it('issues HttpOnly cookies, minimal bearer identity and documented no-store responses', async () => {
    const session = await identity();
    const response = await api()
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: 'ada@example.com', password })
      .expect(200);
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringMatching(/HttpOnly; SameSite=Strict/)]),
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toHaveProperty('data.refreshToken');
    expect((await me(session).expect(200)).body).toMatchObject({
      data: { email: 'ada@example.com', userType: 'customer', sessionId: session.sessionId },
    });
    await api().get('/api/v1/auth/me').expect(401);
    await api().get('/api/v1/auth/me').set('Cookie', session.cookie).expect(401);
  });

  it('rotates refresh tokens and durably revokes the whole session on replay', async () => {
    const first = await identity();
    const second = result(await refresh(first).expect(200));
    expect(second.cookie).not.toBe(first.cookie);
    expect(second.csrfToken).not.toBe(first.csrfToken);
    expect(second.sessionId).toBe(first.sessionId);
    expect(await db.source.getRepository(RefreshTokenEntity).count()).toBe(2);
    await refresh(first).expect(401);
    const row = await db.source
      .getRepository(SessionEntity)
      .findOneByOrFail({ id: first.sessionId });
    expect(row.revokedAt).not.toBeNull();
    await me(second).expect(401);
    await refresh(second).expect(401);
    expect(
      (await db.source.getRepository(RefreshTokenEntity).find()).every(
        (token) => token.revokedAt !== null,
      ),
    ).toBe(true);
  });

  it('serializes simultaneous refreshes: one rotates, the reuse revokes the family', async () => {
    const original = await identity();
    const results = await Promise.all([refresh(original), refresh(original)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 401]);
    const winner = results.find((response) => response.status === 200);
    if (!winner) throw new Error('Missing rotation winner');
    await me(result(winner)).expect(401);
    expect(await db.source.getRepository(RefreshTokenEntity).count()).toBe(2);
  });

  it('rejects missing/wrong CSRF and disallowed or missing origins without consuming a refresh token', async () => {
    const session = await identity();
    await api()
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', session.cookie)
      .expect(403);
    await api()
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', newOpaqueToken())
      .expect(403);
    await api()
      .post('/api/v1/auth/refresh')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken)
      .expect(403);
    await api()
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://evil.example.com')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrfToken)
      .expect(403);
    const csrf = await api()
      .post('/api/v1/auth/csrf')
      .set('Origin', origin)
      .set('Cookie', session.cookie)
      .expect(200);
    expect(csrf.body).toMatchObject({ data: { csrfToken: session.csrfToken } });
    await refresh(session).expect(200);
  });

  it('logs out with cookie+CSRF even when access JWT is absent and rejects its bearer immediately', async () => {
    const session = await identity();
    const response = await logout(session).expect(204);
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('Expires=Thu, 01 Jan 1970')]),
    );
    await me(session).expect(401);
    await refresh(session).expect(401);
    await logout(session).expect(204);
  });

  it('logout and refresh races never leave a live successor', async () => {
    const session = await identity();
    const results = await Promise.all([refresh(session), logout(session)]);
    expect(results[1]?.status).toBe(204);
    expect([200, 401]).toContain(results[0]?.status);
    await me(session).expect(401);
    if (results[0]?.status === 200) await refresh(result(results[0])).expect(401);
  });

  it('lists only owned device sessions, denies cross-user revocation and supports logout-all', async () => {
    const first = await identity();
    const second = await login();
    const other = await identity('grace@example.com');
    const list = await api()
      .get('/api/v1/auth/sessions?limit=10')
      .auth(first.accessToken, { type: 'bearer' })
      .expect(200);
    expect(list.body).toMatchObject({ meta: { total: 2 } });
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|tokenDigest|userAgent|ipAddress/);
    await api()
      .delete(`/api/v1/auth/sessions/${other.sessionId}`)
      .set('Origin', origin)
      .auth(first.accessToken, { type: 'bearer' })
      .expect(404);
    await api()
      .delete(`/api/v1/auth/sessions/${second.sessionId}`)
      .set('Origin', origin)
      .auth(first.accessToken, { type: 'bearer' })
      .expect(204);
    await me(second).expect(401);
    await me(first).expect(200);
    await api()
      .post('/api/v1/auth/logout-all')
      .set('Origin', origin)
      .auth(first.accessToken, { type: 'bearer' })
      .expect(204);
    await me(first).expect(401);
    await me(other).expect(200);
  });

  it.each(['inactive', 'unverified', 'locked'])(
    'denies %s accounts during JWT access, login and refresh',
    async (state) => {
      const session = await identity();
      const changes =
        state === 'inactive'
          ? { status: 'inactive' as const }
          : state === 'unverified'
            ? { emailVerifiedAt: null }
            : { lockedUntil: new Date(Date.now() + 60000) };
      await db.source.getRepository(UserEntity).update({ email: 'ada@example.com' }, changes);
      await me(session).expect(401);
      await api()
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email: 'ada@example.com', password })
        .expect(401);
      await refresh(session).expect(401);
    },
  );

  it('commits failed-attempt lockout and permits login after the bounded lock expires', async () => {
    await identity();
    for (let i = 0; i < 5; i++)
      await api()
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email: 'ada@example.com', password: 'wrong password' })
        .expect(401);
    const row = await db.source
      .getRepository(UserEntity)
      .findOneByOrFail({ email: 'ada@example.com' });
    expect(row.failedLoginAttempts).toBe(5);
    expect(row.lockedUntil).not.toBeNull();
    await api()
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: row.email, password })
      .expect(401);
    await db.source
      .getRepository(UserEntity)
      .update({ id: row.id }, { lockedUntil: new Date(Date.now() - 1000) });
    await login();
    expect(
      (await db.source.getRepository(UserEntity).findOneByOrFail({ id: row.id }))
        .failedLoginAttempts,
    ).toBe(0);
  });

  it('rejects login proofs when the credential changes before session creation', async () => {
    await identity();
    const proof = await app.get(LocalStrategy).authenticate('ada@example.com', password);
    await db.source
      .getRepository(UserEntity)
      .update({ id: proof.userId }, { passwordHash: 'changed-hash' });
    await expect(app.get(SessionAuthService).login(proof, {})).rejects.toThrow(
      'Invalid credentials',
    );
  });

  it('rejects expired access/session/refresh tokens and unknown refresh credentials', async () => {
    const session = await identity();
    const user = await db.source
      .getRepository(UserEntity)
      .findOneByOrFail({ email: 'ada@example.com' });
    const expired = await app.get(AccessTokenService).sign(user.id, session.sessionId, -1);
    await api().get('/api/v1/auth/me').auth(expired, { type: 'bearer' }).expect(401);
    await db.source.query(
      "UPDATE refresh_tokens SET created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour'",
    );
    await refresh(session).expect(401);
    const next = await login();
    await db.source.query(
      "UPDATE sessions SET created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour'",
    );
    await me(next).expect(401);
    await refresh(next).expect(401);
    const unknown = `foundation_refresh=${newOpaqueToken()}`;
    const csrfResponse = await api()
      .post('/api/v1/auth/csrf')
      .set('Origin', origin)
      .set('Cookie', unknown)
      .expect(200);
    const csrf = (csrfResponse.body as { data: { csrfToken: string } }).data.csrfToken;
    await api()
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', unknown)
      .set('X-CSRF-Token', csrf)
      .expect(401);
  });

  it('validates local-login input before strategy execution, rejects privilege assignment and login CSRF', async () => {
    await api()
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: {}, password: {} })
      .expect(400);
    await api()
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ email: 'ada@example.com', password, userType: 'administrator' })
      .expect(400);
    await api()
      .post('/api/v1/auth/register')
      .send({ email: 'ada@example.com', password })
      .expect(403);
    await api()
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ email: 'ada@example.com', password })
      .expect(403);
  });

  it('retains rate limiting on public login and documents real auth paths', async () => {
    for (let i = 0; i < 10; i++)
      await api()
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email: 'unknown@example.com', password })
        .expect(401);
    await api()
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: 'unknown@example.com', password })
      .expect(429);
    const openapi = await api().get('/docs/openapi.json').expect(200);
    expect(openapi.body).toHaveProperty('paths./api/v1/auth/login');
    expect(openapi.body).toHaveProperty('components.securitySchemes.bearer');
    await api().get('/api/v1/health/live').expect(200);
    await api().delete(`/api/v1/auth/sessions/${randomUUID()}`).set('Origin', origin).expect(401);
  });
});
