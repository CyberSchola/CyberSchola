import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Who supervises which class, who teaches what, and which students are where.
 *
 * These four tables are what blueprint sections 13 and 14 derive a teacher's
 * access from: a teacher may reach a student if they supervise the student's
 * class, or teach a subject that student takes. The rule itself lives once, as
 * a reusable access scope in application code; these tables are the facts it
 * reads.
 *
 * Every reference carries the tenant, for the reason documented in
 * CreateAcademicStructure: a plain foreign key check bypasses row-level security
 * and would let a row in one school point at a row in another.
 *
 * The indexes are the ones the access scope's three branches actually use, each
 * partial on `deleted_at IS NULL` like every other index here. These tables are
 * new and would otherwise have none, so the scope would scan without them.
 */
export class CreateTeachingAssignments1757600300000 implements MigrationInterface {
  name = 'CreateTeachingAssignments1757600300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /** A teacher responsible for a class: the form teacher. */
    await queryRunner.query(`
      CREATE TABLE class_supervisors (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        class_id    uuid NOT NULL,
        teacher_id  uuid NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz,
        deleted_by  uuid,
        archived_at timestamptz,
        CONSTRAINT class_supervisors_class_fk FOREIGN KEY (tenant_id, class_id)
          REFERENCES classes (tenant_id, id),
        CONSTRAINT class_supervisors_teacher_fk FOREIGN KEY (tenant_id, teacher_id)
          REFERENCES teachers (tenant_id, id)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX class_supervisors_unique_live
      ON class_supervisors (class_id, teacher_id) WHERE deleted_at IS NULL
    `);
    // The scope's first branch starts from the teacher.
    await queryRunner.query(`
      CREATE INDEX class_supervisors_teacher_live_idx
      ON class_supervisors (teacher_id, class_id) WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('class_supervisors')`);

    /**
     * A subject taught in a class, by a teacher.
     *
     * `is_elective` is what keeps access exact. Everyone enrolled in the class
     * takes a core subject, so a core subject needs no per-student rows. An
     * elective is taken only by students registered for it, so an SS2 Physics
     * teacher reaches the students taking Physics rather than every arts student
     * sitting in the same class.
     */
    await queryRunner.query(`
      CREATE TABLE class_subjects (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        class_id     uuid NOT NULL,
        subject_id   uuid NOT NULL,
        teacher_id   uuid NOT NULL,
        is_elective  boolean NOT NULL DEFAULT false,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        deleted_at   timestamptz,
        deleted_by   uuid,
        archived_at  timestamptz,
        CONSTRAINT class_subjects_tenant_id_unique UNIQUE (tenant_id, id),
        CONSTRAINT class_subjects_class_fk FOREIGN KEY (tenant_id, class_id)
          REFERENCES classes (tenant_id, id),
        CONSTRAINT class_subjects_subject_fk FOREIGN KEY (tenant_id, subject_id)
          REFERENCES subjects (tenant_id, id),
        CONSTRAINT class_subjects_teacher_fk FOREIGN KEY (tenant_id, teacher_id)
          REFERENCES teachers (tenant_id, id)
      )
    `);

    // A subject is taught once per class. Two teachers splitting a subject is a
    // real case, and it belongs to a later co-teaching change rather than to a
    // duplicate row here that would make "who teaches Physics in SS2A" ambiguous.
    await queryRunner.query(`
      CREATE UNIQUE INDEX class_subjects_unique_live
      ON class_subjects (class_id, subject_id) WHERE deleted_at IS NULL
    `);
    // The scope's second and third branches start from the teacher.
    await queryRunner.query(`
      CREATE INDEX class_subjects_teacher_live_idx
      ON class_subjects (teacher_id, class_id) WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('class_subjects')`);

    /**
     * A student in a class for a session.
     *
     * Carries `session_id` alongside `class_id`, and that copy cannot go wrong:
     * the composite foreign key to `classes (tenant_id, id, session_id)` means
     * the session recorded here must be the class's own session. What it buys is
     * the unique index below, which forbids one student being enrolled in two
     * classes in the same session. Without the copy that rule needs a trigger.
     */
    await queryRunner.query(`
      CREATE TABLE class_enrolments (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        class_id    uuid NOT NULL,
        session_id  uuid NOT NULL,
        student_id  uuid NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz,
        deleted_by  uuid,
        archived_at timestamptz,
        CONSTRAINT class_enrolments_class_fk FOREIGN KEY (tenant_id, class_id, session_id)
          REFERENCES classes (tenant_id, id, session_id),
        CONSTRAINT class_enrolments_student_fk FOREIGN KEY (tenant_id, student_id)
          REFERENCES students (tenant_id, id)
      )
    `);

    // One class per student per session. Doubles as the by-student index the
    // scope uses to find a student's class.
    await queryRunner.query(`
      CREATE UNIQUE INDEX class_enrolments_one_class_per_session
      ON class_enrolments (student_id, session_id) WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX class_enrolments_class_live_idx
      ON class_enrolments (class_id, student_id) WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('class_enrolments')`);

    /** A student taking an elective. Only electives need these rows. */
    await queryRunner.query(`
      CREATE TABLE elective_registrations (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        class_subject_id  uuid NOT NULL,
        student_id        uuid NOT NULL,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        deleted_at        timestamptz,
        deleted_by        uuid,
        archived_at       timestamptz,
        CONSTRAINT elective_registrations_subject_fk FOREIGN KEY (tenant_id, class_subject_id)
          REFERENCES class_subjects (tenant_id, id),
        CONSTRAINT elective_registrations_student_fk FOREIGN KEY (tenant_id, student_id)
          REFERENCES students (tenant_id, id)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX elective_registrations_unique_live
      ON elective_registrations (class_subject_id, student_id) WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('elective_registrations')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS elective_registrations`);
    await queryRunner.query(`DROP TABLE IF EXISTS class_enrolments`);
    await queryRunner.query(`DROP TABLE IF EXISTS class_subjects`);
    await queryRunner.query(`DROP TABLE IF EXISTS class_supervisors`);
  }
}
