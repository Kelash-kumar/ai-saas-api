import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from './environment';

@Injectable()
export class RuntimeConfig {
  readonly app;
  readonly logging;
  readonly security;

  constructor(config: ConfigService<Environment, true>) {
    this.app = Object.freeze({
      environment: config.get('NODE_ENV', { infer: true }),
      name: config.get('APP_NAME', { infer: true }),
      host: config.get('HOST', { infer: true }),
      port: config.get('PORT', { infer: true }),
      swaggerEnabled: config.get('SWAGGER_ENABLED', { infer: true }),
      shutdownTimeoutMs: config.get('SHUTDOWN_TIMEOUT_MS', { infer: true }),
    });
    this.logging = Object.freeze({ level: config.get('LOG_LEVEL', { infer: true }) });
    this.security = Object.freeze({
      corsOrigins: Object.freeze(
        config
          .get('CORS_ORIGINS', { infer: true })
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      ),
      rateLimitTtlMs: config.get('RATE_LIMIT_TTL_MS', { infer: true }),
      rateLimitMax: config.get('RATE_LIMIT_MAX', { infer: true }),
    });
  }
}
