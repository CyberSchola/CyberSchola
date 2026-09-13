import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes application access to a tenant-owned table inseparable from its policy.
 *
 * The problem this fixes, raised in review of BE-T01:
 *
 * `CreateApplicationRole` granted default privileges on every future table in
 * `public`. That was convenient and it was the wrong default. A later migration
 * could write
 *
 *     CREATE TABLE students (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, ...);
 *
 * and `cyberschola_app` would immediately hold SELECT, INSERT, UPDATE and
 * DELETE on it, with no policy, no RLS, and nothing failing. Tenant isolation
 * would then depend on the author remembering to call
 * `apply_tenant_isolation`. Forgetting produced a table every school could read
 * in full, silently, which is the exact failure mode the whole of BE-T01 is
 * built to remove.
 *
 * The shape of the fix is to make the safe path the only path:
 *
 * 1. The blanket default privilege on TABLES is revoked. A new table now grants
 *    the application nothing at all.
 * 2. `apply_tenant_isolation` issues the grant itself, after it has enabled and
 *    forced RLS and created the policy.
 *
 * So access and isolation are applied by one call and cannot come apart. The
 * failure mode inverts: forgetting the call no longer yields an unprotected
 * table, it yields a table the application gets "permission denied" on the
 * first time it is touched. Loud and safe instead of silent and dangerous.
 *
 * The function also now refuses a table with no `tenant_id` column, so calling
 * it on a global table fails at migration time rather than creating a policy
 * that can never match.
 *
 * Default privileges on SEQUENCES are deliberately left in place. A sequence
 * holds no tenant data, and revoking it would break a future `bigserial`
 * column for no security gain.
 *
 * A new migration rather than an edit to the original, because the original has
 * already run against Supabase and against every developer database. Editing an
 * applied migration changes nothing for the databases that already ran it.
 */
export class BindGrantsToTenantIsolation1757400300000 implements MigrationInterface {
  name = 'BindGrantsToTenantIsolation1757400300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Future tables start with no application access. Existing tables keep the
    // grants they were given explicitly; ALTER DEFAULT PRIVILEGES only ever
    // affects objects created after it runs.
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM cyberschola_app
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION apply_tenant_isolation(target_table text)
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      BEGIN
        -- A table with no tenant_id cannot satisfy this policy, so every read
        -- would return nothing and every write would be rejected. Failing here
        -- turns that into an obvious migration error instead of a table that
        -- appears protected and is simply broken.
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = target_table
            AND column_name = 'tenant_id'
        ) THEN
          RAISE EXCEPTION
            'apply_tenant_isolation(%) was called on a table with no tenant_id column. '
            'Tenant-owned tables need that column; global tables should be granted '
            'explicitly instead.', target_table;
        END IF;

        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target_table);
        EXECUTE format(
          'CREATE POLICY tenant_isolation ON %I
             USING (tenant_id = current_tenant_id())
             WITH CHECK (tenant_id = current_tenant_id())',
          target_table
        );

        -- The grant comes last and comes from here. This is the whole point:
        -- the application can only reach a tenant-owned table through the same
        -- call that secured it, so there is no window and no forgotten step.
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO cyberschola_app',
          target_table
        );
      END
      $$;
    `);

    // Idempotent, and it re-applies the grant through the new path so the
    // existing table is in the same state a newly created one would be.
    await queryRunner.query(`SELECT apply_tenant_isolation('tenant_settings')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cyberschola_app
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION apply_tenant_isolation(target_table text)
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      BEGIN
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target_table);
        EXECUTE format(
          'CREATE POLICY tenant_isolation ON %I
             USING (tenant_id = current_tenant_id())
             WITH CHECK (tenant_id = current_tenant_id())',
          target_table
        );
      END
      $$;
    `);
  }
}
