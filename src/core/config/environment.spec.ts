import { validateEnvironment as validate } from './environment';
import { RuntimeConfig } from './runtime-config.service';
import { ConfigService } from '@nestjs/config';
import type { Environment } from './environment';
import { testAuthSettings, testProductionMailSettings } from '../../../test/support/auth-settings';

function validateEnvironment(input: Record<string, unknown>) {
  return validate({
    DATABASE_PASSWORD: 'unit-test-password',
    ...testAuthSettings,
    ...(input.NODE_ENV === 'production' ? testProductionMailSettings : {}),
    ...input,
  });
}

describe('Configuration boundary', () => {
  it('requires production mail configuration, trusted reset URLs, verified TLS and sufficient leases', () => {
    expect(() =>
      validateEnvironment({ NODE_ENV: 'production', DATABASE_SSL: true, MAIL_TRANSPORT: 'file' }),
    ).toThrow('MAIL_TRANSPORT');
    expect(() =>
      validateEnvironment({ MAIL_PUBLIC_URL: 'https://user:secret@example.com' }),
    ).toThrow('MAIL_PUBLIC_URL');
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_SSL: true,
        MAIL_SMTP_REQUIRE_TLS: false,
      }),
    ).toThrow('TLS');
    expect(() => validateEnvironment({ MAIL_SMTP_USER: 'user' })).toThrow('together');
    expect(() => validateEnvironment({ MAIL_LEASE_MS: 15000 })).toThrow('budget');
  });
  it('requires distinct authentication keys and bounds access-token lifetime', () => {
    expect(() => validateEnvironment({ AUTH_JWT_KEY: undefined })).toThrow('AUTH_JWT_KEY');
    expect(() => validateEnvironment({ AUTH_CSRF_KEY: testAuthSettings.AUTH_JWT_KEY })).toThrow(
      'distinct',
    );
    expect(() => validateEnvironment({ AUTH_ACCESS_TTL_SECONDS: 901 })).toThrow(
      'AUTH_ACCESS_TTL_SECONDS',
    );
  });
  it('requires database credentials and verified TLS in production', () => {
    expect(() => validate({})).toThrow('DATABASE_PASSWORD');
    expect(() => validateEnvironment({ NODE_ENV: 'production', DATABASE_SSL: false })).toThrow(
      'DATABASE_SSL',
    );
    expect(validateEnvironment({ NODE_ENV: 'production', DATABASE_SSL: true }).DATABASE_SSL).toBe(
      true,
    );
  });
  it('coerces environment strings and applies safe defaults', () => {
    const env = validateEnvironment({ PORT: '4000', SWAGGER_ENABLED: 'false' });
    expect(env.PORT).toBe(4000);
    expect(env.SWAGGER_ENABLED).toBe(false);
    expect(env.HOST).toBe('127.0.0.1');
  });

  it.each([
    { PORT: 'abc' },
    { PORT: '0' },
    { RATE_LIMIT_MAX: '-1' },
    { NODE_ENV: 'typo' },
    { SWAGGER_ENABLED: 'maybe' },
    { CORS_ORIGINS: '*' },
    { CORS_ORIGINS: 'https://example.com/path' },
    { NODE_ENV: 'production', CORS_ORIGINS: 'http://example.com' },
  ])('rejects invalid settings: %j', (input) => {
    expect(() => validateEnvironment(input)).toThrow();
  });

  it('does not echo invalid values', () => {
    expect(() => validateEnvironment({ PORT: 'SUPER_SECRET' })).toThrow('PORT');
    try {
      validateEnvironment({ PORT: 'SUPER_SECRET' });
    } catch (error) {
      expect(String(error)).not.toContain('SUPER_SECRET');
    }
  });

  it('exposes immutable typed domains and exact CORS origins', () => {
    const config = new RuntimeConfig(
      new ConfigService<Environment, true>(
        validateEnvironment({
          CORS_ORIGINS: 'https://app.example.com, https://admin.example.com',
        }),
      ),
    );
    expect(config.security.corsOrigins).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
    expect(Object.isFrozen(config.app)).toBe(true);
    expect(Object.isFrozen(config.security.corsOrigins)).toBe(true);
  });
});
