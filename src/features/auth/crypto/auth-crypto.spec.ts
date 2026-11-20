import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { AuthConfig } from '../../../core/config/auth-config.service';
import { validateEnvironment } from '../../../core/config/environment';
import type { Environment } from '../../../core/config/environment';
import {
  testAuthSettings,
  testProductionMailSettings,
} from '../../../../test/support/auth-settings';
import { AccessTokenService } from './access-token.service';
import { ArgonPasswordHasher } from './argon-password-hasher';
import { newOpaqueToken, tokenDigest } from './opaque-token';
import { EncryptedVerificationMessage } from '../../notifications/verification-message.factory';
import { SessionCookies } from '../transport/session-cookies';
import type { Request, Response } from 'express';

const config = (extra: Record<string, unknown> = {}) =>
  new AuthConfig(
    new ConfigService<Environment, true>(
      validateEnvironment({
        DATABASE_PASSWORD: 'unit-test-password',
        ...testAuthSettings,
        ...(extra.NODE_ENV === 'production' ? testProductionMailSettings : {}),
        ...extra,
      }),
    ),
  );

describe('Authentication cryptography', () => {
  it('uses salted Argon2id, preserves password whitespace and performs dummy verification', async () => {
    const hasher = new ArgonPasswordHasher();
    await hasher.onModuleInit();
    const secret = '  a long passphrase  ';
    const hash = await hasher.hash(secret);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await hasher.verify(hash, secret)).toBe(true);
    expect(await hasher.verify(hash, secret.trim())).toBe(false);
    expect(await hasher.verify(undefined, secret)).toBe(false);
    expect(await hasher.verify('bad-hash', secret)).toBe(false);
    expect(await hasher.hash(secret)).not.toBe(hash);
  });

  it('creates random opaque tokens and stores only stable digests', () => {
    const token = newOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newOpaqueToken()).not.toBe(token);
    expect(tokenDigest(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenDigest(token)).toBe(tokenDigest(token));
  });

  it('authenticates encrypted outbox data and binds it to recipient and key ID', () => {
    const codec = new EncryptedVerificationMessage(config());
    const token = newOpaqueToken();
    const mail = codec.prepare('ada@example.com', token);
    expect(mail.payloadCiphertext.toString()).not.toContain(token);
    expect(codec.open(mail.recipient, mail.keyId, mail.payloadCiphertext)).toEqual({ token });
    expect(() => codec.open('attacker@example.com', mail.keyId, mail.payloadCiphertext)).toThrow();
    expect(() => codec.open(mail.recipient, 'another-key', mail.payloadCiphertext)).toThrow();
    const corrupted = Buffer.from(mail.payloadCiphertext);
    corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] ?? 0) ^ 1;
    expect(() => codec.open(mail.recipient, mail.keyId, corrupted)).toThrow();
  });

  it('issues signed access claims and rejects wrong issuer, audience, algorithm, expired or incomplete claims', async () => {
    const settings = config();
    const jwt = new JwtService();
    const service = new AccessTokenService(jwt, settings);
    const userId = randomUUID();
    const sessionId = randomUUID();
    const token = await service.sign(userId, sessionId, 60);
    expect(await service.verify(token)).toEqual({ userId, sessionId });
    const base = {
      subject: userId,
      jwtid: randomUUID(),
      issuer: settings.settings.issuer,
      audience: settings.settings.audience,
      secret: settings.settings.jwtKey,
      expiresIn: 60,
    };
    for (const options of [
      { issuer: 'wrong' },
      { audience: 'wrong' },
      { expiresIn: -1 },
      { algorithm: 'HS384' as const },
    ]) {
      const bad = await jwt.signAsync(
        { sid: sessionId, tokenUse: 'access' },
        { ...base, ...options },
      );
      await expect(service.verify(bad)).rejects.toThrow('Authentication required');
    }
    await expect(service.verify(await jwt.signAsync({ sid: sessionId }, base))).rejects.toThrow();
    await expect(service.verify('not-a-jwt')).rejects.toThrow();
  });

  it('uses host-only secure HttpOnly production cookies and binds CSRF to the refresh token', () => {
    const cookies = new SessionCookies(config({ NODE_ENV: 'production', DATABASE_SSL: true }));
    const token = newOpaqueToken();
    const request = {
      headers: { cookie: `${cookies.name}=${token}`, 'x-csrf-token': cookies.csrf(token) },
    } as Pick<Request, 'headers'>;
    expect(cookies.name).toBe('__Host-foundation_refresh');
    expect(() => cookies.checkCsrf(request)).not.toThrow();
    request.headers['x-csrf-token'] = cookies.csrf(newOpaqueToken());
    expect(() => cookies.checkCsrf(request)).toThrow('CSRF validation failed');
    const cookie = jest.fn();
    cookies.write({ cookie } as unknown as Response, {
      accessToken: 'access',
      csrfToken: 'csrf',
      expiresIn: 60,
      refreshToken: token,
      sessionId: randomUUID(),
      sessionExpiresAt: new Date(Date.now() + 60000),
    });
    expect(cookie).toHaveBeenCalledWith(
      '__Host-foundation_refresh',
      token,
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'strict', path: '/' }),
    );
  });
});
