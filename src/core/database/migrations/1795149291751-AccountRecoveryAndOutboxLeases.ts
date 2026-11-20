import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountRecoveryAndOutboxLeases1795149291751 implements MigrationInterface {
  name = 'AccountRecoveryAndOutboxLeases1795149291751';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "account_activation_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "token_digest" character(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "consumed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "ck_activation_expiry" CHECK (expires_at > created_at), CONSTRAINT "ck_activation_digest" CHECK (token_digest ~ '^[a-f0-9]{64}$'), CONSTRAINT "PK_deb98a9cf505693a59c438f3cd4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_activation_expires" ON "account_activation_tokens"  ("expires_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_activation_user" ON "account_activation_tokens"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_activation_digest" ON "account_activation_tokens"  ("token_digest") `,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "deactivation_source" character varying(16)`);
    await queryRunner.query(`ALTER TABLE "mail_outbox" ADD "lease_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "mail_outbox" ADD "leased_until" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "mail_outbox" ADD "dead_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "ck_users_deactivation_source" CHECK (deactivation_source IS NULL OR deactivation_source IN ('self', 'administrative'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "mail_outbox" ADD CONSTRAINT "ck_outbox_lease" CHECK ((lease_id IS NULL) = (leased_until IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "account_activation_tokens" ADD CONSTRAINT "FK_d932c3ad8dfa95df7229094cb33" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "account_activation_tokens" DROP CONSTRAINT "FK_d932c3ad8dfa95df7229094cb33"`,
    );
    await queryRunner.query(`ALTER TABLE "mail_outbox" DROP CONSTRAINT "ck_outbox_lease"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "ck_users_deactivation_source"`);
    await queryRunner.query(`ALTER TABLE "mail_outbox" DROP COLUMN "dead_at"`);
    await queryRunner.query(`ALTER TABLE "mail_outbox" DROP COLUMN "leased_until"`);
    await queryRunner.query(`ALTER TABLE "mail_outbox" DROP COLUMN "lease_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deactivation_source"`);
    await queryRunner.query(`DROP INDEX "public"."uq_activation_digest"`);
    await queryRunner.query(`DROP INDEX "public"."ix_activation_user"`);
    await queryRunner.query(`DROP INDEX "public"."ix_activation_expires"`);
    await queryRunner.query(`DROP TABLE "account_activation_tokens"`);
  }
}
