import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives every existing membership the role row that now carries its role.
 *
 * Until this phase, `memberships.role` was the role. From here on, the role
 * tables are, and `memberships.role` is removed two migrations later. Without
 * this step every existing member would lose their role at that point and be
 * refused everything, including school administrators, who would have no way to
 * put it right.
 *
 * Only where no live row already exists: students and teachers anchored through
 * BE-S01 already have theirs, and a second live row would violate the one-per-
 * membership index.
 *
 * Soft-deleted memberships get a row soft-deleted at the same moment, so the
 * history stays consistent: nothing that was removed becomes live again.
 * Suspension lives on the membership, not the role, so suspended members keep a
 * live role row and remain unable to sign in through their membership status.
 *
 * Names are unknown for people who only ever had a membership, so they are
 * written empty. The API refuses an empty name on create and update, so an
 * administrator fills them in the first time the record is edited.
 *
 * Written against `memberships.role` directly, because at this point in the
 * chain the column still exists. The pre-drop upgrade test runs the migrations
 * up to the one before this, seeds memberships of every role, and runs the rest.
 */
export class BackfillRolesFromMemberships1757700100000 implements MigrationInterface {
  name = 'BackfillRolesFromMemberships1757700100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO school_admins (tenant_id, membership_id, deleted_at)
      SELECT m.tenant_id, m.id, m.deleted_at
        FROM memberships m
       WHERE m.role = 'SCHOOL_ADMIN'
         AND NOT EXISTS (
           SELECT 1 FROM school_admins r WHERE r.membership_id = m.id AND r.deleted_at IS NULL
         )
    `);

    for (const [table, role] of [
      ['teachers', 'TEACHER'],
      ['students', 'STUDENT'],
      ['parents', 'PARENT'],
      ['staff', 'STAFF'],
    ] as const) {
      await queryRunner.query(`
        INSERT INTO ${table} (tenant_id, membership_id, first_name, last_name, deleted_at)
        SELECT m.tenant_id, m.id, '', '', m.deleted_at
          FROM memberships m
         WHERE m.role = '${role}'
           AND NOT EXISTS (
             SELECT 1 FROM ${table} r WHERE r.membership_id = m.id AND r.deleted_at IS NULL
           )
      `);
    }
  }

  /**
   * Nothing to undo safely.
   *
   * A backfilled row cannot be told apart from one an administrator created
   * afterwards, and deleting the wrong one removes a real person's role. The
   * rows are harmless under the previous schema, which ignores them.
   */
  public async down(): Promise<void> {
    // Intentionally empty. See the note above.
  }
}
