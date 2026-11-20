import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from './environment';

@Injectable()
export class DatabaseConfig {
  readonly connection;
  constructor(config: ConfigService<Environment, true>) {
    this.connection = Object.freeze({
      host: config.get('DATABASE_HOST', { infer: true }),
      port: config.get('DATABASE_PORT', { infer: true }),
      database: config.get('DATABASE_NAME', { infer: true }),
      username: config.get('DATABASE_USER', { infer: true }),
      password: config.get('DATABASE_PASSWORD', { infer: true }),
      ssl: config.get('DATABASE_SSL', { infer: true }),
      poolMax: config.get('DATABASE_POOL_MAX', { infer: true }),
      timeoutMs: config.get('DATABASE_TIMEOUT_MS', { infer: true }),
    });
  }
}
