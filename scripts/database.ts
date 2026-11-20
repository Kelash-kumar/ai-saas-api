import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadCliConfig } from '../src/core/config/load-cli-config';
import { databaseOptions } from '../src/core/database/database.options';

async function main(): Promise<void> {
  const config = loadCliConfig();
  const command = process.argv[2];
  if (!['create', 'migrate', 'revert', 'status', 'schema-check'].includes(command ?? ''))
    throw new Error('Invalid database command');
  const options = databaseOptions(config.database);
  if (command === 'create' && config.environment.NODE_ENV === 'production')
    throw new Error('Database creation is a development-only command');
  const source = await new DataSource(
    command === 'create'
      ? { ...options, database: 'postgres', entities: [], migrations: [] }
      : options,
  ).initialize();
  try {
    if (command === 'create') {
      const name = config.database.connection.database; // Validated identifier, never arbitrary SQL input.
      const rows: unknown = await source.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        name,
      ]);
      if (Array.isArray(rows) && rows.length === 0) await source.query(`CREATE DATABASE "${name}"`);
      console.log('Development database is available.');
    } else if (command === 'migrate') {
      const applied = await source.runMigrations();
      console.log(`Applied ${applied.length} migration(s).`);
    } else if (command === 'revert') {
      await source.undoLastMigration();
      console.log('Reverted the last migration.');
    } else if (command === 'status') {
      console.log(
        (await source.showMigrations()) ? 'Migrations are pending.' : 'Migrations are current.',
      );
    } else {
      const diff = await source.driver.createSchemaBuilder().log();
      if (diff.upQueries.length > 0) throw new Error('Entity/migration schema drift detected');
      console.log('Entity metadata matches migrated schema.');
    }
  } finally {
    await source.destroy();
  }
}

void main().catch(() => {
  console.error(
    'Database command failed; check settings, database availability, and migration state.',
  );
  process.exitCode = 1;
});
