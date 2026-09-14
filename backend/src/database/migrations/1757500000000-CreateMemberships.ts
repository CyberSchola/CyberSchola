import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Memberships: which user belongs to which school, and as what.
 *
 * This is decision 17A's storage. The tenant a request acts in is resolved by
 * reading this table, never by reading a claim out of a token body. A token
 * says who you are; this table says where you belong.
 *
 * ## The bootstrap problem, and why this table's policy is not the usual one
 *
 * Every other tenant-owned table is protected by `apply_tenant_isolation`,
 * whose policy compares `tenant_id` against `current_tenant_id()`. This table
 * cannot use it. To resolve the tenant we have to read this table *before* a
 * tenant context exists, so the usual policy would filter on a NULL tenant,
 * return nothing, and every request would fail authentication while the
 * isolation worked perfectly.
 *
 * So the read predicate is keyed on the user as well:
 *
 *     USING (user_id = current_user_id() OR tenant_id = current_tenant_id())
 *
 * During resolution only `app.current_user` is set, so the second half is NULL
 * and false, and a caller sees exactly their own memberships and nothing else.
 * Once a tenant context is open, the second half also lets a school administrator
 * list that school's members. Both halves are enforced by Postgres, so this is
 * still the database holding the boundary rather than application code.
 *
 * ## Why WITH CHECK is deliberately NOT the same expression
 *
 * The write predicate is tenant-only:
 *
 *     WITH CHECK (tenant_id = current_tenant_id())
 *
 * Mirroring the USING clause here would be a privilege escalation, and a quiet
 * one. `user_id = current_user_id()` on a write means any authenticated user
 * could INSERT a row granting themselves membership of any school they cared to
 * name, and the next request would resolve into that school with the isolation
 * working exactly as designed. Reading your own memberships across schools is
 * harmless; writing them is enrolment, and enrolment happens inside a school.
 *
 * `SECURITY DEFINER` was considered and rejected. On Supabase migrations run as
 * `postgres`, a superuser, so such a function would bypass RLS entirely and
 * become the first bypass primitive in the system. Keeping the rule in a policy
 * keeps it in the one place the rest of the architecture already trusts.
 *
 * The `tenants` table is closed separately, in the migration that follows this
 * one, because it must exist before a policy can reference it.
 */
export class CreateMemberships1757500000000 implements MigrationInterface {
  name = 'CreateMemberships1757500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /**
     * The authenticated user, read from the transaction-local setting.
     *
     * Mirrors `current_tenant_id()` exactly, including `STABLE` rather than
     * `IMMUTABLE`: the value is fixed within a statement but differs between
     * transactions, and letting the planner cache it across transactions would
     * hand one user another's rows.
     *
     * Returns uuid because Supabase subjects are uuids. A malformed value fails
     * the cast rather than matching something.
     */
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$
        SELECT NULLIF(current_setting('app.current_user', true), '')::uuid
      $$;
    `);

    /**
     * Roles a membership can carry.
     *
     * School-scoped on purpose. There is no SUPER_ADMIN here: a platform
     * administrator is not a member of a school, and modelling them as one
     * would mean granting a membership row in every tenant. That boundary is
     * recorded in the backend README and is the reason the application role
     * stays restricted regardless of who is signed in.
     *
     * Extending this list is an ALTER TYPE in its own migration.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'memberships_role_enum') THEN
          CREATE TYPE memberships_role_enum AS ENUM
            ('SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT', 'STAFF');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'memberships_status_enum') THEN
          CREATE TYPE memberships_status_enum AS ENUM ('ACTIVE', 'SUSPENDED');
        END IF;
      END
      $$;
    `);

    /**
     * `user_id` is the Supabase subject and carries no foreign key, because the
     * auth schema is Supabase's rather than ours. It is still a uuid, so a
     * malformed subject cannot be stored.
     */
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS memberships (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id     uuid NOT NULL,
        role        memberships_role_enum NOT NULL,
        status      memberships_status_enum NOT NULL DEFAULT 'ACTIVE',
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz,
        deleted_by  uuid,
        archived_at timestamptz
      );
    `);

    /**
     * One live membership per user per school, per decision 8A.
     *
     * Partial, so removing someone and later re-adding them works. A plain
     * UNIQUE would keep the pair reserved by the soft-deleted row and make
     * re-enrolment fail on a record nobody can see.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS memberships_tenant_user_unique_live
      ON memberships (tenant_id, user_id)
      WHERE deleted_at IS NULL;
    `);

    /**
     * The bootstrap lookup, which filters on user_id alone to find the schools
     * a person belongs to. The unique index above leads with tenant_id, so it
     * cannot serve this query and Postgres would scan without this one.
     */
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS memberships_user_live_idx
      ON memberships (user_id)
      WHERE deleted_at IS NULL;
    `);

    // Not apply_tenant_isolation: that function's policy is tenant-only, which
    // is precisely what this table cannot use. The same two properties are set
    // by hand, so the schema conformance suite still sees RLS enabled, forced,
    // and a policy present.
    await queryRunner.query(`ALTER TABLE memberships ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE memberships FORCE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS membership_visibility ON memberships`);
    await queryRunner.query(`
      CREATE POLICY membership_visibility ON memberships
        USING (user_id = current_user_id() OR tenant_id = current_tenant_id())
        WITH CHECK (tenant_id = current_tenant_id());
    `);

    // Explicit, because BindGrantsToTenantIsolation revoked the blanket
    // default privileges. A new table grants the application nothing until a
    // migration says so.
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE memberships TO cyberschola_app;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS memberships`);
    await queryRunner.query(`DROP TYPE IF EXISTS memberships_role_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS memberships_status_enum`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS current_user_id()`);
  }
}
