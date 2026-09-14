import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Row-level security, applied through one reusable function.
 *
 * Every tenant-owned table needs the same four statements. Copying them into
 * each migration is how they drift: one table gets `ENABLE` without `FORCE`,
 * another gets the policy for `SELECT` but not `UPDATE`, and nothing fails
 * until a reviewer happens to look. So the sequence lives in one place and
 * each table is one call.
 *
 * The pieces, and why each is load-bearing:
 *
 * - **ENABLE ROW LEVEL SECURITY** turns policies on. Without it they are
 *   inert decoration.
 * - **FORCE ROW LEVEL SECURITY** makes them bind for the table *owner* too.
 *   Without it, a deployment connecting as the owner has no isolation while
 *   every test that connects as the app role still passes.
 *
 *   One limit worth knowing, verified rather than assumed: FORCE does **not**
 *   constrain a superuser or a role with BYPASSRLS. Those bypass policies
 *   unconditionally, FORCE or not. So on Supabase, `postgres` still reads
 *   everything, which is correct for migrations and is exactly why decision
 *   18A exists. FORCE is the second line; the first is that the application
 *   connects as a role with neither attribute.
 * - **USING** filters what a query can see. **WITH CHECK** governs what it can
 *   write. Only USING would let a caller insert a row stamped with someone
 *   else's tenant id, which it could not then read back but which would still
 *   be there.
 */
export class ApplyTenantIsolation1757400200000 implements MigrationInterface {
  name = 'ApplyTenantIsolation1757400200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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

    /**
     * Per-school configuration.
     *
     * The first tenant-owned table, and it exists for two reasons. The
     * blueprint needs it: lesson note format and similar settings differ per
     * school and cannot be hardcoded. And the isolation machinery above is
     * unproven without a real table to apply it to.
     */
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tenant_settings (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        setting_key citext NOT NULL,
        value       jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz,
        deleted_by  uuid,
        archived_at timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS tenant_settings_tenant_id_idx ON tenant_settings (tenant_id);
    `);

    // Partial, per decision 8A: a soft-deleted setting must not keep its key
    // reserved, or the same key can never be created again for that school.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS tenant_settings_key_unique_live
      ON tenant_settings (tenant_id, setting_key)
      WHERE deleted_at IS NULL;
    `);

    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenant_settings TO cyberschola_app;
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('tenant_settings')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_settings`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS apply_tenant_isolation(text)`);
  }
}
