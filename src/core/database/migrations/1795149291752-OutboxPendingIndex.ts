import type { MigrationInterface, QueryRunner } from 'typeorm';

/** TypeORM does not detect changes to an existing partial-index predicate. */
export class OutboxPendingIndex1795149291752 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX ix_outbox_pending');
    await runner.query(
      'CREATE INDEX ix_outbox_pending ON mail_outbox (available_at, id) WHERE processed_at IS NULL AND dead_at IS NULL',
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX ix_outbox_pending');
    await runner.query(
      'CREATE INDEX ix_outbox_pending ON mail_outbox (available_at, id) WHERE processed_at IS NULL',
    );
  }
}
