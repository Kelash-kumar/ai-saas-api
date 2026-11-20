import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from './environment';
import type { Environment } from './environment';
import { DatabaseConfig } from './database-config.service';

/** Single configuration boundary for non-Nest CLI/test processes. Never print the result. */
export function loadCliConfig(): { environment: Environment; database: DatabaseConfig } {
  const path = resolve('.env');
  const file = existsSync(path) ? parse(readFileSync(path)) : {};
  const environment = validateEnvironment({ ...file, ...process.env });
  return {
    environment,
    database: new DatabaseConfig(new ConfigService<Environment, true>(environment)),
  };
}
