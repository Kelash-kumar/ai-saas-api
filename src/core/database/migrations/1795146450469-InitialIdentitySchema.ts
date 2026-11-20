import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialIdentitySchema1795146450469 implements MigrationInterface {
  name = 'InitialIdentitySchema1795146450469';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "email" character varying(320) NOT NULL, "password_hash" character varying(255) NOT NULL, "user_type" character varying(40) NOT NULL DEFAULT 'customer', "status" character varying(16) NOT NULL DEFAULT 'active', "email_verified_at" TIMESTAMP WITH TIME ZONE, "locked_until" TIMESTAMP WITH TIME ZONE, "failed_login_attempts" integer NOT NULL DEFAULT '0', CONSTRAINT "ck_users_login_attempts" CHECK (failed_login_attempts >= 0), CONSTRAINT "ck_users_status" CHECK (status IN ('active', 'inactive')), CONSTRAINT "ck_users_email_normalized" CHECK (email = lower(btrim(email)) AND length(email) > 3), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "ix_users_created_id" ON "users"  ("created_at", "id") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_email" ON "users"  ("email") `);
    await queryRunner.query(
      `CREATE TABLE "roles" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(80) NOT NULL, "description" character varying(255), CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_roles_name" ON "roles"  ("name") `);
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (current_database(), 'public', 'permissions', 'GENERATED_COLUMN', 'name', $1)`,
      ['"resource" || \'.\' || "action"'],
    );
    await queryRunner.query(
      `CREATE TABLE "permissions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "resource" character varying(80) NOT NULL, "action" character varying(80) NOT NULL, "name" character varying(161) GENERATED ALWAYS AS ("resource" || '.' || "action") STORED NOT NULL, CONSTRAINT "ck_permissions_action" CHECK (action ~ '^[a-z][a-z0-9_-]{0,79}$'), CONSTRAINT "ck_permissions_resource" CHECK (resource ~ '^[a-z][a-z0-9_-]{0,79}$'), CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_permissions_name" ON "permissions"  ("name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user_roles" ("user_id" uuid NOT NULL, "role_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_23ed6f04fe43066df08379fd034" PRIMARY KEY ("user_id", "role_id"))`,
    );
    await queryRunner.query(`CREATE INDEX "ix_user_roles_role" ON "user_roles"  ("role_id") `);
    await queryRunner.query(
      `CREATE TABLE "role_permissions" ("role_id" uuid NOT NULL, "permission_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_25d24010f53bb80b78e412c9656" PRIMARY KEY ("role_id", "permission_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_role_permissions_permission" ON "role_permissions"  ("permission_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user_permissions" ("user_id" uuid NOT NULL, "permission_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a537c48b1f80e8626a71cb56589" PRIMARY KEY ("user_id", "permission_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_user_permissions_permission" ON "user_permissions"  ("permission_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "role_inheritance" ("role_id" uuid NOT NULL, "inherited_role_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_role_inheritance_self" CHECK (role_id <> inherited_role_id), CONSTRAINT "PK_20db8b629983b62f129f872dc20" PRIMARY KEY ("role_id", "inherited_role_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_role_inheritance_inherited_role" ON "role_inheritance"  ("inherited_role_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "sessions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "device_name" character varying(120), "user_agent" character varying(512), "ip_address" inet, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_sessions_expiry" CHECK (expires_at > created_at), CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "ix_sessions_expires" ON "sessions"  ("expires_at") `);
    await queryRunner.query(`CREATE INDEX "ix_sessions_user" ON "sessions"  ("user_id") `);
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "session_id" uuid NOT NULL, "token_digest" character(64) NOT NULL, "parent_id" uuid, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "consumed_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "uq_refresh_id_session" UNIQUE ("id", "session_id"), CONSTRAINT "ck_refresh_parent" CHECK (parent_id IS NULL OR parent_id <> id), CONSTRAINT "ck_refresh_expiry" CHECK (expires_at > created_at), CONSTRAINT "ck_refresh_digest" CHECK (token_digest ~ '^[a-f0-9]{64}$'), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_refresh_expires" ON "refresh_tokens"  ("expires_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_refresh_session" ON "refresh_tokens"  ("session_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_refresh_parent" ON "refresh_tokens"  ("parent_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_refresh_digest" ON "refresh_tokens"  ("token_digest") `,
    );
    await queryRunner.query(
      `CREATE TABLE "password_reset_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "token_digest" character(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "consumed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "ck_password_reset_tokens_expiry" CHECK (expires_at > created_at), CONSTRAINT "ck_password_reset_tokens_digest" CHECK (token_digest ~ '^[a-f0-9]{64}$'), CONSTRAINT "PK_d16bebd73e844c48bca50ff8d3d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_password_reset_tokens_expires" ON "password_reset_tokens"  ("expires_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_password_reset_tokens_user" ON "password_reset_tokens"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_password_reset_tokens_digest" ON "password_reset_tokens"  ("token_digest") `,
    );
    await queryRunner.query(
      `CREATE TABLE "email_verification_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "token_digest" character(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "consumed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "ck_email_verification_tokens_expiry" CHECK (expires_at > created_at), CONSTRAINT "ck_email_verification_tokens_digest" CHECK (token_digest ~ '^[a-f0-9]{64}$'), CONSTRAINT "PK_417a095bbed21c2369a6a01ab9a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_email_verification_tokens_expires" ON "email_verification_tokens"  ("expires_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_email_verification_tokens_user" ON "email_verification_tokens"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_email_verification_tokens_digest" ON "email_verification_tokens"  ("token_digest") `,
    );
    await queryRunner.query(
      `CREATE TABLE "mail_outbox" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "recipient" character varying(320) NOT NULL, "template" character varying(60) NOT NULL, "payload_ciphertext" bytea NOT NULL, "key_id" character varying(64) NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "available_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "processed_at" TIMESTAMP WITH TIME ZONE, "last_error_code" character varying(80), CONSTRAINT "ck_outbox_payload" CHECK (octet_length(payload_ciphertext) > 0), CONSTRAINT "ck_outbox_attempts" CHECK (attempts >= 0), CONSTRAINT "PK_fecc63c96385bc35a39ccf2a72e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_outbox_pending" ON "mail_outbox"  ("available_at", "id") WHERE processed_at IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" ADD CONSTRAINT "FK_87b8888186ca9769c960e926870" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" ADD CONSTRAINT "FK_b23c65e50a758245a33ee35fda1" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_178199805b901ccd220ab7740ec" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_17022daf3f885f7d35423e9971e" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_permissions" ADD CONSTRAINT "FK_3495bd31f1862d02931e8e8d2e8" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_permissions" ADD CONSTRAINT "FK_8145f5fadacd311693c15e41f10" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_inheritance" ADD CONSTRAINT "FK_1a5a1be0ff83033579522b0e4e5" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_inheritance" ADD CONSTRAINT "FK_614bb881ef7b8e7fdc6c068d8d1" FOREIGN KEY ("inherited_role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3bf308fa93da3966f9e76fcfba4" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_62e3a82de51f5fdf76c23d3cc4d" FOREIGN KEY ("parent_id", "session_id") REFERENCES "refresh_tokens"("id","session_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "FK_52ac39dd8a28730c63aeb428c9c" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "FK_fdcb77f72f529bf65c95d72a147" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "email_verification_tokens" DROP CONSTRAINT "FK_fdcb77f72f529bf65c95d72a147"`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "FK_52ac39dd8a28730c63aeb428c9c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_62e3a82de51f5fdf76c23d3cc4d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3bf308fa93da3966f9e76fcfba4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" DROP CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19"`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_inheritance" DROP CONSTRAINT "FK_614bb881ef7b8e7fdc6c068d8d1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_inheritance" DROP CONSTRAINT "FK_1a5a1be0ff83033579522b0e4e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_permissions" DROP CONSTRAINT "FK_8145f5fadacd311693c15e41f10"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_permissions" DROP CONSTRAINT "FK_3495bd31f1862d02931e8e8d2e8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_17022daf3f885f7d35423e9971e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_178199805b901ccd220ab7740ec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT "FK_b23c65e50a758245a33ee35fda1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT "FK_87b8888186ca9769c960e926870"`,
    );
    await queryRunner.query(`DROP INDEX "public"."ix_outbox_pending"`);
    await queryRunner.query(`DROP TABLE "mail_outbox"`);
    await queryRunner.query(`DROP INDEX "public"."uq_email_verification_tokens_digest"`);
    await queryRunner.query(`DROP INDEX "public"."ix_email_verification_tokens_user"`);
    await queryRunner.query(`DROP INDEX "public"."ix_email_verification_tokens_expires"`);
    await queryRunner.query(`DROP TABLE "email_verification_tokens"`);
    await queryRunner.query(`DROP INDEX "public"."uq_password_reset_tokens_digest"`);
    await queryRunner.query(`DROP INDEX "public"."ix_password_reset_tokens_user"`);
    await queryRunner.query(`DROP INDEX "public"."ix_password_reset_tokens_expires"`);
    await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
    await queryRunner.query(`DROP INDEX "public"."uq_refresh_digest"`);
    await queryRunner.query(`DROP INDEX "public"."uq_refresh_parent"`);
    await queryRunner.query(`DROP INDEX "public"."ix_refresh_session"`);
    await queryRunner.query(`DROP INDEX "public"."ix_refresh_expires"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP INDEX "public"."ix_sessions_user"`);
    await queryRunner.query(`DROP INDEX "public"."ix_sessions_expires"`);
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(`DROP INDEX "public"."ix_role_inheritance_inherited_role"`);
    await queryRunner.query(`DROP TABLE "role_inheritance"`);
    await queryRunner.query(`DROP INDEX "public"."ix_user_permissions_permission"`);
    await queryRunner.query(`DROP TABLE "user_permissions"`);
    await queryRunner.query(`DROP INDEX "public"."ix_role_permissions_permission"`);
    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP INDEX "public"."ix_user_roles_role"`);
    await queryRunner.query(`DROP TABLE "user_roles"`);
    await queryRunner.query(`DROP INDEX "public"."uq_permissions_name"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = 'GENERATED_COLUMN' AND "name" = 'name' AND "database" = current_database() AND "schema" = 'public' AND "table" = 'permissions'`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_roles_name"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP INDEX "public"."uq_users_email"`);
    await queryRunner.query(`DROP INDEX "public"."ix_users_created_id"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
