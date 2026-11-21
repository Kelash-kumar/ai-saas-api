import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ManagedAccountApproval1795310000000 implements MigrationInterface {
  name = 'ManagedAccountApproval1795310000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE users ADD access_approved_at timestamptz, ADD access_approved_by uuid',
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE users DROP access_approved_at, DROP access_approved_by');
  }
}
