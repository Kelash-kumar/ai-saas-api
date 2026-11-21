import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CrmManagement1795300000000 implements MigrationInterface {
  name = 'CrmManagement1795300000000';
  async up(r: QueryRunner): Promise<void> {
    await r.query(
      `ALTER TABLE users ADD username varchar(80), ADD date_of_birth date, ADD gender varchar(20), ADD avatar_data varchar(8000), ADD notification_channel varchar(16) NOT NULL DEFAULT 'none', ADD two_factor varchar(16) NOT NULL DEFAULT 'none'`,
    );
    await r.query(
      `CREATE UNIQUE INDEX uq_users_username ON users(username) WHERE username IS NOT NULL`,
    );
    await r.query(`ALTER TABLE roles ADD guard varchar(16) NOT NULL DEFAULT 'user'`);
    await r.query(`ALTER TABLE companies ADD deleted_at timestamptz`);
    await r.query(
      `CREATE TABLE login_challenges (id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), user_id uuid NOT NULL, token_digest varchar(64) NOT NULL, code_digest varchar(64) NOT NULL, credential_stamp varchar(64) NOT NULL, admin_portal boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0, consumed_at timestamptz, CONSTRAINT pk_login_challenges PRIMARY KEY(id), CONSTRAINT fk_login_challenges_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    );
    await r.query(
      'CREATE UNIQUE INDEX uq_login_challenge_digest ON login_challenges(token_digest)',
    );
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE login_challenges');
    await r.query('ALTER TABLE companies DROP deleted_at');
    await r.query('ALTER TABLE roles DROP guard');
    await r.query('DROP INDEX uq_users_username');
    await r.query(
      'ALTER TABLE users DROP username, DROP date_of_birth, DROP gender, DROP avatar_data, DROP notification_channel, DROP two_factor',
    );
  }
}
