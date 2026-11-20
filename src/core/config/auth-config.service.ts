import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from './environment';

@Injectable()
export class AuthConfig {
  readonly settings;
  constructor(config: ConfigService<Environment, true>) {
    this.settings = Object.freeze({
      jwtKey: Buffer.from(config.get('AUTH_JWT_KEY', { infer: true }), 'base64'),
      csrfKey: Buffer.from(config.get('AUTH_CSRF_KEY', { infer: true }), 'base64'),
      outboxKey: Buffer.from(config.get('AUTH_OUTBOX_KEY', { infer: true }), 'base64'),
      outboxKeyId: config.get('AUTH_OUTBOX_KEY_ID', { infer: true }),
      issuer: config.get('AUTH_JWT_ISSUER', { infer: true }),
      audience: config.get('AUTH_JWT_AUDIENCE', { infer: true }),
      accessTtl: config.get('AUTH_ACCESS_TTL_SECONDS', { infer: true }),
      refreshTtl: config.get('AUTH_REFRESH_TTL_SECONDS', { infer: true }),
      verificationTtl: config.get('AUTH_VERIFICATION_TTL_SECONDS', { infer: true }),
      maxAttempts: config.get('AUTH_LOGIN_MAX_ATTEMPTS', { infer: true }),
      lockSeconds: config.get('AUTH_LOCK_SECONDS', { infer: true }),
      resetTtl: config.get('AUTH_RESET_TTL_SECONDS', { infer: true }),
      activationTtl: config.get('AUTH_ACTIVATION_TTL_SECONDS', { infer: true }),
      secureCookie: config.get('NODE_ENV', { infer: true }) === 'production',
    });
  }
}
