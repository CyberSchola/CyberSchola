import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Attendance for students, teachers and staff.
 *
 * ## One table, and why it is not the polymorphic one
 *
 * Blueprint section 90 asks for a reusable structure rather than three separate
 * systems, with an `attendanceType` and a `userId`. The type is here. The
 * `userId` is not, and cannot be: a single polymorphic column can carry no
 * foreign key, and a reference between tenant-owned tables that carries no
 * tenant is exactly the hole that makes one school's row able to point at
 * another school's record. A membership id would not work either, because a
 * student record exists before the child has a login and many never get one.
 *
 * So the subject is three nullable columns, one per kind, each with its own
 * composite foreign key, and a check constraint that exactly one of them is set
 * and that it matches the type. Postgres validates a multi-column foreign key
 * only when every column in it is non-null, so the unused two cost nothing and
 * the used one is fully checked. Section 93's cross-type reporting stays a
 * single query over a single table.
 *
 * ## The academic context cannot be wrong
 *
 * Section 92 puts the session, term and class on a student's record. All three
 * are derivable from the date and the enrolment, so storing them risks saying a
 * child was in a class they were never in. The foreign key therefore points at
 * the enrolment itself rather than at `classes`, through the enrolment's own id
 * plus the three columns:
 *
 *     (tenant_id, enrolment_id, class_id, session_id, student_id)
 *       -> class_enrolments (tenant_id, id, class_id, session_id, student_id)
 *
 * which the database can only satisfy from one real enrolment row. Note the
 * shape of the key it references: extending `(tenant_id, id)` with the columns
 * we want guaranteed, rather than making `(tenant_id, class_id, session_id,
 * student_id)` unique on its own. That is deliberate twice over. It is unique by
 * construction because the primary key is in it, so it can never conflict with a
 * soft-deleted enrolment the way a natural key would, and it is not partial, so
 * a foreign key can reference it at all. `classes` already carries the same
 * trick for the same reason, and its comment says so.
 *
 * Attendance keeps pointing at an enrolment that is later soft-deleted, which is
 * correct: the child was in that class on that day, and unenrolling them now
 * does not change what happened then.
 *
 * ## One record per person per school day
 *
 * Section 94's rule, as a partial unique index per context rather than one
 * constraint over everything. Subject and live-class attendance are named in the
 * blueprint as likely, and their rule is different: one record per subject per
 * day, not one per day. A single unique key cannot express both, and the usual
 * workaround, a nullable column inside the key, does not work here because
 * Postgres treats NULLs as distinct and the rule would silently stop applying.
 *
 * `attendance_context` therefore exists now and is restricted by check to
 * `SCHOOL_DAY`, with one partial unique index for that context. Supporting
 * `SUBJECT_CLASS` later is a migration that relaxes the check and adds a second
 * partial index, with nothing to change on the rows already stored.
 *
 * ## Statuses are not the same for everyone
 *
 * Section 91 gives teachers and staff `LEAVE` and does not give it to students,
 * and asks the backend to validate that. It is a check constraint rather than
 * only a DTO rule, so a job, a migration or a hand-written statement cannot
 * store a status the domain does not have. `attendance-status.integration-spec`
 * compares the database enum against the TypeScript one, the same way the role
 * enum is kept in step, so a value added on one side alone fails the build.
 */
export class CreateAttendance1757800000000 implements MigrationInterface {
  name = 'CreateAttendance1757800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // -----------------------------------------------------------------------
    // Keys for attendance to reference. Both extend an existing unique key with
    // the columns attendance needs guaranteed, so they are unique by
    // construction and add no rule of their own.
    // -----------------------------------------------------------------------

    await queryRunner.query(`
      ALTER TABLE terms
        ADD CONSTRAINT terms_tenant_id_session_unique UNIQUE (tenant_id, id, session_id)
    `);

    await queryRunner.query(`
      ALTER TABLE class_enrolments
        ADD CONSTRAINT class_enrolments_tenant_id_context_unique
          UNIQUE (tenant_id, id, class_id, session_id, student_id)
    `);

    // -----------------------------------------------------------------------
    // The domain's vocabulary.
    // -----------------------------------------------------------------------

    await queryRunner.query(`
      CREATE TYPE attendance_type_enum AS ENUM ('STUDENT', 'TEACHER', 'STAFF')
    `);

    await queryRunner.query(`
      CREATE TYPE attendance_status_enum AS ENUM
        ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'SICK', 'LEAVE')
    `);

    // SUBJECT_CLASS and LIVE_CLASS are named by section 94 as where this is
    // going. They are in the type and refused by the check below, so adding one
    // is a rule change rather than a type change on a populated column.
    await queryRunner.query(`
      CREATE TYPE attendance_context_enum AS ENUM ('SCHOOL_DAY', 'SUBJECT_CLASS', 'LIVE_CLASS')
    `);

    // -----------------------------------------------------------------------
    // The table.
    // -----------------------------------------------------------------------

    await queryRunner.query(`
      CREATE TABLE attendance (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        attendance_type    attendance_type_enum NOT NULL,
        attendance_context attendance_context_enum NOT NULL DEFAULT 'SCHOOL_DAY',
        date               date NOT NULL,
        status             attendance_status_enum NOT NULL,
        check_in_time      timestamptz,
        check_out_time     timestamptz,
        remarks            text,
        marked_by          uuid NOT NULL,
        student_id         uuid,
        teacher_id         uuid,
        staff_id           uuid,
        enrolment_id       uuid,
        class_id           uuid,
        session_id         uuid,
        term_id            uuid,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now(),
        deleted_at         timestamptz,
        deleted_by         uuid,
        archived_at        timestamptz,

        CONSTRAINT attendance_tenant_id_unique UNIQUE (tenant_id, id),

        -- Exactly one subject, and it is the one the type names. Written as a
        -- CASE over the type rather than three ORed conditions so that adding a
        -- fourth kind of attendance fails loudly here (a CASE with no matching
        -- branch yields NULL, and a NULL check constraint does not pass).
        CONSTRAINT attendance_subject_matches_type CHECK (
          CASE attendance_type
            WHEN 'STUDENT' THEN student_id IS NOT NULL AND teacher_id IS NULL AND staff_id IS NULL
            WHEN 'TEACHER' THEN teacher_id IS NOT NULL AND student_id IS NULL AND staff_id IS NULL
            WHEN 'STAFF'   THEN staff_id   IS NOT NULL AND student_id IS NULL AND teacher_id IS NULL
          END
        ),

        -- Section 91. LEAVE is a teacher and staff status; a student is EXCUSED
        -- or SICK instead.
        CONSTRAINT attendance_status_allowed_for_type CHECK (
          attendance_type <> 'STUDENT' OR status <> 'LEAVE'
        ),

        -- Section 92's academic context belongs to a student record and to no
        -- other kind, and its four columns arrive together or not at all. The
        -- foreign key below then has either every column or none, which is what
        -- makes it checked exactly when it applies.
        CONSTRAINT attendance_academic_context_complete CHECK (
          (attendance_type = 'STUDENT') = (enrolment_id IS NOT NULL)
          AND (enrolment_id IS NULL) = (class_id IS NULL)
          AND (enrolment_id IS NULL) = (session_id IS NULL)
          AND (enrolment_id IS NULL) = (term_id IS NULL)
        ),

        -- Section 94's later contexts are in the type and not yet supported.
        -- Relaxing this is the whole of the change when SUBJECT_CLASS arrives.
        CONSTRAINT attendance_context_supported CHECK (attendance_context = 'SCHOOL_DAY'),

        -- A departure time with no arrival is not a record of anything, and
        -- leaving before arriving is a typo rather than a day.
        CONSTRAINT attendance_times_ordered CHECK (
          check_out_time IS NULL
          OR (check_in_time IS NOT NULL AND check_out_time > check_in_time)
        ),

        -- The subject, per kind. Each is checked only for the kind that sets it.
        CONSTRAINT attendance_student_fk FOREIGN KEY (tenant_id, student_id)
          REFERENCES students (tenant_id, id),
        CONSTRAINT attendance_teacher_fk FOREIGN KEY (tenant_id, teacher_id)
          REFERENCES teachers (tenant_id, id),
        CONSTRAINT attendance_staff_fk FOREIGN KEY (tenant_id, staff_id)
          REFERENCES staff (tenant_id, id),

        -- The academic context, all of it at once, against the enrolment that
        -- proves the student was in that class in that session.
        CONSTRAINT attendance_enrolment_fk
          FOREIGN KEY (tenant_id, enrolment_id, class_id, session_id, student_id)
          REFERENCES class_enrolments (tenant_id, id, class_id, session_id, student_id),

        -- The term, carrying the session, so a term from another session cannot
        -- be recorded against this one.
        CONSTRAINT attendance_term_fk FOREIGN KEY (tenant_id, term_id, session_id)
          REFERENCES terms (tenant_id, id, session_id),

        -- Who marked it. A membership rather than a user id: it is the
        -- tenant-scoped identity of an authenticated person, so a marker from
        -- another school cannot be stored, and the correction trail uses the
        -- same identity for who changed a record.
        CONSTRAINT attendance_marked_by_fk FOREIGN KEY (tenant_id, marked_by)
          REFERENCES memberships (tenant_id, id)
      )
    `);

    // -----------------------------------------------------------------------
    // Section 94's rule, one index per subject kind, for SCHOOL_DAY only.
    //
    // Partial on `deleted_at IS NULL` because the table soft-deletes: without
    // that, a removed record keeps occupying the day and the register cannot be
    // taken again. Partial on the subject column too, so rows of the other two
    // kinds are not indexed at all rather than indexed as NULL.
    // -----------------------------------------------------------------------

    for (const [kind, column] of [
      ['student', 'student_id'],
      ['teacher', 'teacher_id'],
      ['staff', 'staff_id'],
    ]) {
      await queryRunner.query(`
        CREATE UNIQUE INDEX attendance_one_per_${kind}_school_day
        ON attendance (tenant_id, ${column}, date)
        WHERE attendance_context = 'SCHOOL_DAY' AND ${column} IS NOT NULL AND deleted_at IS NULL
      `);
    }

    // -----------------------------------------------------------------------
    // The read paths this phase actually has. A student's own history is
    // already served by the unique index above, which leads on the student.
    // -----------------------------------------------------------------------

    // A class register for one day, which a teacher opens every morning.
    await queryRunner.query(`
      CREATE INDEX attendance_class_day_idx
      ON attendance (tenant_id, class_id, date) WHERE deleted_at IS NULL
    `);

    // The whole school's counts for a day. Status is in the index so the count
    // can be answered without visiting the table.
    await queryRunner.query(`
      CREATE INDEX attendance_school_day_idx
      ON attendance (tenant_id, date, status) WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('attendance')`);

    // -----------------------------------------------------------------------
    // A record has to fall inside the term it names.
    //
    // A check constraint cannot do this: the dates live on `terms`, and a check
    // may not read another table. The same reasoning, and the same shape, as the
    // trigger that keeps a term inside its session.
    //
    // 23514 is check_violation, so the exception filter reports it as 422 rather
    // than as a 500, exactly as it does for that trigger.
    // -----------------------------------------------------------------------

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION attendance_within_term() RETURNS trigger AS $$
      DECLARE
        term_start date;
        term_end   date;
      BEGIN
        IF NEW.term_id IS NULL THEN
          RETURN NEW;
        END IF;

        SELECT starts_on, ends_on INTO term_start, term_end
          FROM terms
         WHERE id = NEW.term_id AND tenant_id = NEW.tenant_id;

        IF term_start IS NULL THEN
          RETURN NEW;  -- no such term: the foreign key refuses it first
        END IF;

        IF NEW.date < term_start OR NEW.date > term_end THEN
          RAISE EXCEPTION
            'Attendance dated % is outside its term, which runs from % to %.',
            NEW.date, term_start, term_end
            USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER attendance_within_term_trigger
      BEFORE INSERT OR UPDATE OF date, term_id ON attendance
      FOR EACH ROW EXECUTE FUNCTION attendance_within_term()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS attendance_within_term_trigger ON attendance`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS attendance_within_term()`);
    await queryRunner.query(`DROP TABLE IF EXISTS attendance`);
    await queryRunner.query(`DROP TYPE IF EXISTS attendance_context_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS attendance_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS attendance_type_enum`);

    await queryRunner.query(`
      ALTER TABLE class_enrolments
        DROP CONSTRAINT IF EXISTS class_enrolments_tenant_id_context_unique
    `);
    await queryRunner.query(`
      ALTER TABLE terms DROP CONSTRAINT IF EXISTS terms_tenant_id_session_unique
    `);
  }
}
