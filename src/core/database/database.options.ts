import { join } from 'node:path';
import type { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';
import type { DatabaseConfig } from '../config/database-config.service';
import { entities } from './entities';

export function databaseOptions(config: DatabaseConfig): PostgresDataSourceOptions {
  const connection = config.connection;
  return {
    type: 'postgres',
    host: connection.host,
    port: connection.port,
    database: connection.database,
    username: connection.username,
    password: connection.password,
    ssl: connection.ssl ? { rejectUnauthorized: true } : false,
    entities,
    migrations: [join(__dirname, 'migrations', '[0-9]*{.ts,.js}')],
    migrationsTableName: 'schema_migrations',
    migrationsTransactionMode: 'all',
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    logging: false,
    invalidWhereValuesBehavior: { null: 'throw', undefined: 'throw' },
    installExtensions: false,
    uuidExtension: 'pgcrypto',
    poolSize: connection.poolMax,
    connectTimeoutMS: connection.timeoutMs,
    extra: {
      connectionTimeoutMillis: connection.timeoutMs,
      idleTimeoutMillis: 30000,
      statement_timeout: connection.timeoutMs,
      query_timeout: connection.timeoutMs,
      application_name: 'auth-foundation',
    },
  };
}
