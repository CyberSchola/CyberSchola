import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enables row-level security on `tenants`, which had none.
 *
 * `CreateTenants` granted `cyberschola_app` full SELECT, INSERT, UPDATE and
 * DELETE on this table and never enabled row-level security on it. That was not
 * exploitable at the time, because nothing could authenticate and so no request
 * ever reached the table. BE-A01 is what makes it reachable: from this point an
 * authenticated caller would otherwise be able to list every school in the
 * system, and rename or delete them.
 *
 * The schema conformance suite did not catch it, and the reason is worth
 * recording. That suite looks for tables carrying a `tenant_id` column, and
 * this table has none: it *is* the tenant, and its own `id` plays that role. A
 * check written around one column shape had a blind spot exactly where the
 * shape differed.
 *
 * ## The policy
 *
 *     USING (id = current_tenant_id() OR EXISTS (a live membership of it))
 *     WITH CHECK (id = current_tenant_id())
 *
 * A school is visible when it is the one being acted in, or when the caller has
 * a live membership of it. The second half is what makes "which schools do I
 * belong to" answerable before a school has been chosen. It is evaluated
 * against `memberships`, which is itself behind its own policy, so it cannot be
 * turned into a way to read anyone else's memberships.
 *
 * `WITH CHECK` is narrower than `USING`, for the same reason it is on
 * `memberships`: being able to see a school is not permission to alter it, and
 * writes belong to the school currently being acted in. One consequence worth
 * stating plainly is that creating a school is not possible through the
 * application role at all, since there is no tenant context before the school
 * exists. School onboarding is an out-of-band operation until there is a
 * deliberate flow for it, and failing closed is the right default meanwhile.
 *
 * Separate from the memberships migration, even though the two were written
 * together, because this one fixes an existing hole rather than adding a new
 * table. It deserves its own entry in the history and its own revert.
 */
export class SecureTenantsTable1757500100000 implements MigrationInterface {
  name = 'SecureTenantsTable1757500100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tenants ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE tenants FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_visibility ON tenants`);
    await queryRunner.query(`
      CREATE POLICY tenant_visibility ON tenants
        USING (
          id = current_tenant_id()
          OR EXISTS (
            SELECT 1 FROM memberships m
             WHERE m.tenant_id = tenants.id
               AND m.user_id = current_user_id()
               AND m.deleted_at IS NULL
          )
        )
        WITH CHECK (id = current_tenant_id());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_visibility ON tenants`);
    await queryRunner.query(`ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE tenants DISABLE ROW LEVEL SECURITY`);
  }
}
