import type { MigrationInterface, QueryRunner } from 'typeorm';
export class UserCompanyManagement1795233600000 implements MigrationInterface {
  name = 'UserCompanyManagement1795233600000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'CREATE TABLE companies (id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), name varchar(160) NOT NULL, email varchar(320), phone varchar(30), website varchar(500), address varchar(2000), CONSTRAINT pk_companies PRIMARY KEY(id), CONSTRAINT ck_companies_name CHECK(length(btrim(name)) > 0), CONSTRAINT ck_companies_email CHECK(email IS NULL OR (email = lower(btrim(email)) AND length(email) > 3)))',
    );
    await runner.query('CREATE UNIQUE INDEX uq_companies_email ON companies(email)');
    await runner.query('CREATE INDEX ix_companies_created_id ON companies(created_at, id)');
    await runner.query(
      'ALTER TABLE users ADD COLUMN first_name varchar(100), ADD COLUMN last_name varchar(100), ADD COLUMN phone varchar(30), ADD COLUMN company_id uuid, ADD COLUMN deleted_at timestamptz, ADD CONSTRAINT fk_users_company FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE RESTRICT',
    );
    await runner.query('CREATE INDEX ix_users_company ON users(company_id)');
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE users DROP CONSTRAINT fk_users_company');
    await runner.query('DROP INDEX ix_users_company');
    await runner.query(
      'ALTER TABLE users DROP COLUMN first_name, DROP COLUMN last_name, DROP COLUMN phone, DROP COLUMN company_id, DROP COLUMN deleted_at',
    );
    await runner.query('DROP TABLE companies');
  }
}
