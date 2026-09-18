import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The role tables as they stand at this migration.
 *
 * A literal on purpose, not `ROLE_TABLES` from the people module. A migration is
 * a record of what the schema was at one point, and importing live application
 * code would let a sixth role added later change what this migration does when
 * the schema is rebuilt from empty, most likely by pointing it at a table that
 * does not exist yet. The role parity test is what keeps the running schema and
 * `ROLE_TABLES` in step.
 */
const ROLE_TABLES_AT_THIS_POINT = ['school_admins', 'teachers', 'students', 'parents', 'staff'];

/**
 * A role lives and dies with the membership that holds it.
 *
 * Since the previous three migrations a person's roles in a school are the live
 * role rows pointing at their membership. The membership has a lifecycle of its
 * own, and until now the two were independent: a removed membership could keep
 * a live teacher row, and a role could be granted to a membership that was
 * suspended. The request resolver refused both people, so nothing was reachable,
 * but the database could hold a state the domain does not have, and every later
 * reader would have had to compensate for it.
 *
 * ## The lifecycle, stated once
 *
 * - **A role can only be granted to a live, active membership.** Linking a login
 *   to a record, or making a member an administrator, is refused for a suspended
 *   or removed membership. Enforced on every role table by a trigger, so it holds
 *   for a job, a migration or a hand-written statement as well as the API.
 * - **Suspending a membership keeps its roles.** Suspension is reversible; the
 *   school is switching a person off, not rewriting what they are. The roles are
 *   inert while suspended, because the request resolver and the job context both
 *   refuse a membership that is not ACTIVE, and they come back on reactivation.
 * - **Removing a membership ends every role it holds, in the same statement.**
 *   An administrator row is soft-deleted. A person record is unlinked rather
 *   than deleted, because the record describes a real person who exists before
 *   and after any login: a child whose account is removed is still enrolled.
 *   Only live rows are touched. A role row that was already deleted is history,
 *   and keeps its link so it still says whose it was; the backfill in migration
 *   1757700100000 relies on exactly that for members removed before it ran.
 * - **A removed membership has no effective role even if a row survived.** The
 *   `membership_roles` view now reads through the membership and requires it to
 *   be live. The trigger keeps the stored state consistent; the view guarantees
 *   the answer regardless, so the two are enforced twice and neither alone is
 *   the guarantee.
 * - **Removing a membership cannot remove a school's last administrator.** The
 *   same rule `removeAdmin` enforces, under the same lock, because ending roles
 *   on removal would otherwise be a second way round it.
 *
 * Re-enrolment follows from this. A person who leaves and comes back gets a new
 * membership with no roles; their records are still there, unlinked, and an
 * administrator links them again. Nothing about the old membership carries over
 * by accident.
 *
 * 23514 is check_violation, so the exception filter reports a refused grant as a
 * 422, as it does for every other domain rule the database enforces.
 */
export class TieRolesToMembershipLifecycle1757700400000 implements MigrationInterface {
  name = 'TieRolesToMembershipLifecycle1757700400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // -----------------------------------------------------------------------
    // Granting: every role table refuses a membership that is not live and
    // active. Fires only when the link or the row's own liveness changes, so
    // editing a suspended teacher's name still works.
    // -----------------------------------------------------------------------

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION role_requires_active_membership() RETURNS trigger AS $$
      DECLARE
        holder_status text;
      BEGIN
        IF NEW.membership_id IS NULL OR NEW.deleted_at IS NOT NULL THEN
          RETURN NEW;
        END IF;

        SELECT status::text INTO holder_status
          FROM memberships
         WHERE id = NEW.membership_id
           AND tenant_id = NEW.tenant_id
           AND deleted_at IS NULL;

        IF holder_status IS NULL THEN
          RAISE EXCEPTION
            'A role can only be given to a live membership of this school; % has been removed.',
            NEW.membership_id
            USING ERRCODE = '23514';
        END IF;

        IF holder_status <> 'ACTIVE' THEN
          RAISE EXCEPTION
            'A role can only be given to an active membership; % is %.',
            NEW.membership_id, lower(holder_status)
            USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    for (const table of ROLE_TABLES_AT_THIS_POINT) {
      await queryRunner.query(`
        CREATE TRIGGER ${table}_requires_active_membership
        BEFORE INSERT OR UPDATE OF membership_id, deleted_at ON ${table}
        FOR EACH ROW EXECUTE FUNCTION role_requires_active_membership()
      `);
    }

    // -----------------------------------------------------------------------
    // Removing: a membership's roles end with it.
    // -----------------------------------------------------------------------

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION end_roles_of_removed_membership() RETURNS trigger AS $$
      DECLARE
        remaining_admins integer;
      BEGIN
        -- The last-administrator rule, under the same lock removeAdmin takes, so
        -- two removals at once serialise and the second counts what is left.
        IF EXISTS (
          SELECT 1 FROM school_admins
           WHERE membership_id = NEW.id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL
        ) THEN
          PERFORM 1 FROM school_admins
            WHERE tenant_id = NEW.tenant_id AND deleted_at IS NULL
            FOR UPDATE;

          SELECT count(*) INTO remaining_admins
            FROM school_admins
           WHERE tenant_id = NEW.tenant_id
             AND deleted_at IS NULL
             AND membership_id <> NEW.id;

          IF remaining_admins = 0 THEN
            RAISE EXCEPTION
              'This membership holds the school''s last administrator role, so it cannot be '
              'removed. Add another administrator first.'
              USING ERRCODE = '23514';
          END IF;
        END IF;

        UPDATE school_admins
           SET deleted_at = NEW.deleted_at, deleted_by = NEW.deleted_by
         WHERE membership_id = NEW.id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL;

        UPDATE students SET membership_id = NULL
         WHERE membership_id = NEW.id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL;
        UPDATE teachers SET membership_id = NULL
         WHERE membership_id = NEW.id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL;
        UPDATE parents  SET membership_id = NULL
         WHERE membership_id = NEW.id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL;
        UPDATE staff    SET membership_id = NULL
         WHERE membership_id = NEW.id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER memberships_end_roles_on_removal
      AFTER UPDATE OF deleted_at ON memberships
      FOR EACH ROW
      WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
      EXECUTE FUNCTION end_roles_of_removed_membership()
    `);

    // Anything left over from before this migration: roles of memberships that
    // were already removed end now, the same way a removal ends them from here on.
    await queryRunner.query(`
      UPDATE school_admins r SET deleted_at = m.deleted_at, deleted_by = m.deleted_by
        FROM memberships m
       WHERE m.id = r.membership_id AND m.deleted_at IS NOT NULL AND r.deleted_at IS NULL
    `);
    for (const table of ['students', 'teachers', 'parents', 'staff']) {
      await queryRunner.query(`
        UPDATE ${table} r SET membership_id = NULL
          FROM memberships m
         WHERE m.id = r.membership_id AND m.deleted_at IS NOT NULL AND r.deleted_at IS NULL
      `);
    }

    // -----------------------------------------------------------------------
    // Reading: a role is effective only through a live membership. Same
    // columns, same branches, same invoker semantics as before.
    // -----------------------------------------------------------------------

    await queryRunner.query(`DROP VIEW membership_roles`);
    await queryRunner.query(membershipRolesView(true));
    await queryRunner.query(`GRANT SELECT ON membership_roles TO cyberschola_app`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW membership_roles`);
    await queryRunner.query(membershipRolesView(false));
    await queryRunner.query(`GRANT SELECT ON membership_roles TO cyberschola_app`);

    await queryRunner.query(
      `DROP TRIGGER IF EXISTS memberships_end_roles_on_removal ON memberships`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS end_roles_of_removed_membership()`);

    for (const table of ROLE_TABLES_AT_THIS_POINT) {
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS ${table}_requires_active_membership ON ${table}`,
      );
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS role_requires_active_membership()`);
  }
}

/**
 * The view, with or without the live-membership requirement.
 *
 * One definition for both directions so that `down` restores exactly what the
 * previous migration created, rather than a hand-copied version of it.
 */
function membershipRolesView(requireLiveMembership: boolean): string {
  const branch = (table: string, role: string, linkOptional: boolean) => {
    const live = requireLiveMembership
      ? `
          JOIN memberships m
            ON m.id = r.membership_id
           AND m.tenant_id = r.tenant_id
           AND m.deleted_at IS NULL`
      : '';

    return `
        SELECT r.tenant_id, r.membership_id, '${role}'::memberships_role_enum AS role
          FROM ${table} r${live}
         WHERE r.deleted_at IS NULL${linkOptional ? ' AND r.membership_id IS NOT NULL' : ''}`;
  };

  return `
      CREATE VIEW membership_roles WITH (security_invoker = true) AS
        ${[
          branch('school_admins', 'SCHOOL_ADMIN', false),
          branch('teachers', 'TEACHER', true),
          branch('students', 'STUDENT', true),
          branch('parents', 'PARENT', true),
          branch('staff', 'STAFF', true),
        ].join('\n        UNION ALL')}
  `;
}
