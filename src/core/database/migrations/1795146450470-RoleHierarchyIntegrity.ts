import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Custom invariants that ORM metadata cannot express. All hierarchy writes use READ COMMITTED. */
export class RoleHierarchyIntegrity1795146450470 implements MigrationInterface {
  name = 'RoleHierarchyIntegrity1795146450470';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE FUNCTION enforce_role_hierarchy_acyclic() RETURNS trigger
      LANGUAGE plpgsql VOLATILE AS $$
      BEGIN
        -- Higher-isolation snapshots could remain stale after this lock wait.
        IF current_setting('transaction_isolation') <> 'read committed' THEN
          RAISE EXCEPTION 'Hierarchy writes require READ COMMITTED' USING ERRCODE = '23514';
        END IF;
        PERFORM pg_advisory_xact_lock(23001, 1);
        IF EXISTS (
          WITH RECURSIVE ancestors(id) AS (
            SELECT NEW.inherited_role_id
            UNION
            SELECT edge.inherited_role_id FROM role_inheritance edge
            JOIN ancestors parent ON edge.role_id = parent.id
            WHERE TG_OP <> 'UPDATE' OR (edge.role_id, edge.inherited_role_id) <> (OLD.role_id, OLD.inherited_role_id)
          ) SELECT 1 FROM ancestors WHERE id = NEW.role_id
        ) THEN
          RAISE EXCEPTION 'Role hierarchy cycle rejected' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$
    `);
    await runner.query(`CREATE TRIGGER role_hierarchy_acyclic BEFORE INSERT OR UPDATE ON role_inheritance
      FOR EACH ROW EXECUTE FUNCTION enforce_role_hierarchy_acyclic()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TRIGGER role_hierarchy_acyclic ON role_inheritance');
    await runner.query('DROP FUNCTION enforce_role_hierarchy_acyclic()');
  }
}
