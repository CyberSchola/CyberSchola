import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A person's roles in a school, read from the role rows that carry them.
 *
 * One view rather than five lookups, so the resolver asks one question: which
 * roles does this membership hold. Each branch filters to live rows that are
 * linked to a membership, which is what holding a role means. A record without a
 * login holds no role for anyone.
 *
 * ## security_invoker, and why it is not optional
 *
 * By default a Postgres view runs with the privileges of its owner. The owner
 * here is the migration role, which on Supabase is `postgres`, and `postgres`
 * bypasses row-level security. A default view over these tables would therefore
 * return every school's role rows to the application, with every policy on the
 * underlying tables intact and irrelevant.
 *
 * `security_invoker = true` (Postgres 15 and later) evaluates the view as the
 * caller, so the policies on the five tables apply exactly as if they were
 * queried directly. The schema conformance suite fails the build on any view in
 * `public` that does not set it.
 */
export class CreateMembershipRolesView1757700200000 implements MigrationInterface {
  name = 'CreateMembershipRolesView1757700200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE VIEW membership_roles WITH (security_invoker = true) AS
        SELECT tenant_id, membership_id, 'SCHOOL_ADMIN'::memberships_role_enum AS role
          FROM school_admins
         WHERE deleted_at IS NULL
        UNION ALL
        SELECT tenant_id, membership_id, 'TEACHER'::memberships_role_enum
          FROM teachers
         WHERE deleted_at IS NULL AND membership_id IS NOT NULL
        UNION ALL
        SELECT tenant_id, membership_id, 'STUDENT'::memberships_role_enum
          FROM students
         WHERE deleted_at IS NULL AND membership_id IS NOT NULL
        UNION ALL
        SELECT tenant_id, membership_id, 'PARENT'::memberships_role_enum
          FROM parents
         WHERE deleted_at IS NULL AND membership_id IS NOT NULL
        UNION ALL
        SELECT tenant_id, membership_id, 'STAFF'::memberships_role_enum
          FROM staff
         WHERE deleted_at IS NULL AND membership_id IS NOT NULL
    `);

    // A view is a new object, and the application is granted nothing on new
    // objects by default (see BindGrantsToTenantIsolation). Read-only: roles
    // change by writing the role tables, never the view.
    await queryRunner.query(`GRANT SELECT ON membership_roles TO cyberschola_app`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS membership_roles`);
  }
}
