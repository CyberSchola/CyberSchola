import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes `memberships.role`, now that the role rows are the only source.
 *
 * Kept as its own migration, after the backfill and the view, so the chain reads
 * in the order it has to happen: new tables, copy the roles across, read them
 * through the view, then retire the old column. Leaving the column in place
 * "just in case" would leave a field that looks authoritative and is not, and
 * the first query to read it would be quietly wrong for every teacher who is
 * also a parent.
 *
 * The enum type stays. `membership_roles` casts to it, and the Role enum parity
 * test compares against it.
 */
export class DropMembershipsRole1757700300000 implements MigrationInterface {
  name = 'DropMembershipsRole1757700300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE memberships DROP COLUMN role`);
  }

  /**
   * Restores the column from the view, choosing one role per membership.
   *
   * The previous schema holds a single role, so a person with several keeps the
   * most privileged. A membership holding no role at all cannot be given one
   * honestly, so the column is left nullable if any exist, and a revert of this
   * phase should be followed by fixing those rows by hand.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE memberships ADD COLUMN role memberships_role_enum`);

    // Reads the role tables directly rather than the view, so a soft-deleted
    // membership recovers the role its soft-deleted row carried. Live rows win.
    await queryRunner.query(`
      UPDATE memberships m
         SET role = (
           SELECT r.role
             FROM (
               SELECT membership_id, deleted_at, 'SCHOOL_ADMIN'::memberships_role_enum AS role FROM school_admins
               UNION ALL SELECT membership_id, deleted_at, 'TEACHER' FROM teachers
               UNION ALL SELECT membership_id, deleted_at, 'STUDENT' FROM students
               UNION ALL SELECT membership_id, deleted_at, 'PARENT'  FROM parents
               UNION ALL SELECT membership_id, deleted_at, 'STAFF'   FROM staff
             ) r
            WHERE r.membership_id = m.id
            ORDER BY r.deleted_at IS NOT NULL,
                     array_position(
                       ARRAY['SCHOOL_ADMIN', 'TEACHER', 'STAFF', 'PARENT', 'STUDENT']::memberships_role_enum[],
                       r.role
                     )
            LIMIT 1
         )
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM memberships WHERE role IS NULL) THEN
          ALTER TABLE memberships ALTER COLUMN role SET NOT NULL;
        END IF;
      END
      $$;
    `);
  }
}
