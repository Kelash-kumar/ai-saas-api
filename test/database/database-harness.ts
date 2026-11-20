import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { loadCliConfig } from '../../src/core/config/load-cli-config';
import { databaseOptions } from '../../src/core/database/database.options';

const ownedName = /^foundation_test_[a-f0-9]{32}$/;

export class DatabaseHarness {
  private constructor(
    readonly source: DataSource,
    private readonly admin: DataSource,
    readonly name: string,
  ) {}

  static async create(): Promise<DatabaseHarness> {
    const config = loadCliConfig();
    if (config.environment.NODE_ENV === 'production')
      throw new Error('Refusing database tests in production');
    const options = databaseOptions(config.database);
    const admin = await new DataSource({
      ...options,
      database: 'postgres',
      entities: [],
      migrations: [],
    }).initialize();
    const name = `foundation_test_${randomUUID().replaceAll('-', '')}`;
    // Create only a fresh, owned database. Tests never truncate/migrate the configured application DB.
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
    } catch {
      await admin.destroy();
      throw new Error(
        'Database tests require a disposable PostgreSQL server and CREATEDB privilege',
      );
    }
    const source = new DataSource({ ...options, database: name, poolSize: 5 });
    const harness = new DatabaseHarness(source, admin, name);
    try {
      await source.initialize();
      await source.runMigrations();
      return harness;
    } catch (error) {
      await harness.close();
      throw error;
    }
  }

  async reset(): Promise<void> {
    this.assertOwned();
    await this.source.query('TRUNCATE TABLE users, roles, permissions, mail_outbox CASCADE');
  }

  private assertOwned(): void {
    if (!ownedName.test(this.name) || this.source.options.database !== this.name) {
      throw new Error('Refusing to modify a database not owned by this harness');
    }
  }

  async close(): Promise<void> {
    this.assertOwned();
    try {
      if (this.source.isInitialized) await this.source.destroy();
      await this.admin.query(`DROP DATABASE "${this.name}" WITH (FORCE)`);
    } finally {
      await this.admin.destroy();
    }
  }
}
