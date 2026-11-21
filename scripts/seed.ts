import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { DataSource } from 'typeorm';
import { loadCliConfig } from '../src/core/config/load-cli-config';
import { databaseOptions } from '../src/core/database/database.options';
import { developmentAdmin, seedAdmin } from '../src/core/database/seeds/admin.seed';
async function main() {
  const config = loadCliConfig();
  const env = { ...(existsSync('.env') ? parse(readFileSync('.env')) : {}), ...process.env };
  const production = config.environment.NODE_ENV === 'production';
  if (production && (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD))
    throw new Error('Explicit production credentials required');
  const source = await new DataSource(databaseOptions(config.database)).initialize();
  try {
    await seedAdmin(source, {
      email: env.SEED_ADMIN_EMAIL ?? developmentAdmin.email,
      password: env.SEED_ADMIN_PASSWORD ?? developmentAdmin.password,
      environment: config.environment.NODE_ENV,
    });
    console.log('Admin seed committed. Existing passwords are never reset.');
  } finally {
    await source.destroy();
  }
}
void main().catch(() => {
  console.error('Admin seed failed. Check account eligibility, seed configuration and database.');
  process.exitCode = 1;
});
