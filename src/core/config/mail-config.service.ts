import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from './environment';

@Injectable()
export class MailConfig {
  readonly settings;
  constructor(config: ConfigService<Environment, true>) {
    this.settings = Object.freeze({
      transport: config.get('MAIL_TRANSPORT', { infer: true }),
      from: config.get('MAIL_FROM', { infer: true }),
      publicUrl: config.get('MAIL_PUBLIC_URL', { infer: true }),
      host: config.get('MAIL_SMTP_HOST', { infer: true }),
      port: config.get('MAIL_SMTP_PORT', { infer: true }),
      secure: config.get('MAIL_SMTP_SECURE', { infer: true }),
      requireTls: config.get('MAIL_SMTP_REQUIRE_TLS', { infer: true }),
      user: config.get('MAIL_SMTP_USER', { infer: true }),
      password: config.get('MAIL_SMTP_PASSWORD', { infer: true }),
      timeoutMs: config.get('MAIL_TIMEOUT_MS', { infer: true }),
      leaseMs: config.get('MAIL_LEASE_MS', { infer: true }),
      maxAttempts: config.get('MAIL_MAX_ATTEMPTS', { infer: true }),
      pollMs: config.get('MAIL_POLL_MS', { infer: true }),
    });
  }
}
