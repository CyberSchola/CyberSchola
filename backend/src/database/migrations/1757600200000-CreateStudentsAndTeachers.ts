import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Students and teachers, as thin anchors on a membership.
 *
 * Blueprint section 22 puts Students before Teacher Assignments and Student
 * Enrollment, and section 3 models a student as its own entity. So enrolments
 * and assignments reference these tables rather than `memberships.id`. If they
 * pointed at memberships now, introducing a students table in the people phase
 * would mean migrating every enrolment and assignment to the new key. This way
 * the people phase adds names, guardians and dates of birth as columns on tables
 * that already exist, and no foreign key ever moves.
 *
 * ## Deliberately not tied to `memberships.role`
 *
 * It would be easy to force a `students` row to point only at a STUDENT
 * membership with a composite foreign key on `(membership_id, role)`, and that is
 * not done on purpose.
 *
 * BE-A01 allows one live membership per person per school, carrying one role, so
 * today a teacher whose child attends the same school cannot be both. That is a
 * real limitation, recorded in the README and scheduled for the people phase,
 * where parents force the question. The likely fix is for these rows to become
 * the role assignments themselves, so one membership can carry a teacher row and
 * a parent row. A role-locked foreign key here would bake the single-role model
 * into the schema and have to be undone to make that possible. The role is
 * checked where these rows are created instead.
 */
export class CreateStudentsAndTeachers1757600200000 implements MigrationInterface {
  name = 'CreateStudentsAndTeachers1757600200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The target for the composite references below. A membership's id is
    // already unique, so this constrains nothing new; it exists so a student or
    // teacher row can only point at a membership in its own school.
    await queryRunner.query(`
      ALTER TABLE memberships
      ADD CONSTRAINT memberships_tenant_id_unique UNIQUE (tenant_id, id)
    `);

    for (const table of ['students', 'teachers']) {
      await queryRunner.query(`
        CREATE TABLE ${table} (
          id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          membership_id  uuid NOT NULL,
          created_at     timestamptz NOT NULL DEFAULT now(),
          updated_at     timestamptz NOT NULL DEFAULT now(),
          deleted_at     timestamptz,
          deleted_by     uuid,
          archived_at    timestamptz,
          CONSTRAINT ${table}_tenant_id_unique UNIQUE (tenant_id, id),
          CONSTRAINT ${table}_membership_fk FOREIGN KEY (tenant_id, membership_id)
            REFERENCES memberships (tenant_id, id)
        )
      `);

      // One live anchor per membership. Partial, per decision 8A, so a removed
      // student can be re-added without colliding with the soft-deleted row.
      await queryRunner.query(`
        CREATE UNIQUE INDEX ${table}_membership_unique_live
        ON ${table} (membership_id) WHERE deleted_at IS NULL
      `);

      await queryRunner.query(`SELECT apply_tenant_isolation('${table}')`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS teachers`);
    await queryRunner.query(`DROP TABLE IF EXISTS students`);
    await queryRunner.query(
      `ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_tenant_id_unique`,
    );
  }
}
