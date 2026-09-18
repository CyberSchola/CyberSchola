import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Class timetables: the periods of a school week, and the lessons placed in them.
 *
 * Blueprint Phase 6 puts timetables after enrolment and before attendance, and
 * section 22 lists them among what an administrator shapes. Examination
 * timetables belong to assessments and are not here.
 *
 * ## Every clash rule is a constraint
 *
 * A timetable is edited by hand, often by two people in the same week, and the
 * mistakes it must refuse are all of the "both read a free slot, both wrote"
 * kind. An application check cannot hold those under concurrency, so each rule
 * is one the database enforces, and the service's friendlier pre-check is only
 * there to name the clash in words:
 *
 * - Periods in one session never overlap on the same weekday.
 * - A class has at most one core lesson in a period.
 * - A class never has a core lesson and an elective in the same period. Electives
 *   may run beside each other, which is how an SS2 arts and science split works.
 * - A teacher teaches at most one lesson in a period.
 * - A lesson's period and class belong to the same session, and its teacher and
 *   electiveness are always its class subject's.
 *
 * A pupil registered for two electives that run in the same period is the one
 * clash left to a report rather than refused, because the registration and the
 * lesson are made at different times by different people, and refusing either
 * would block the other's correct work.
 *
 * ## Why the teacher is copied onto the lesson
 *
 * The teacher rule has to be an index, and an index cannot reach through a join
 * to `class_subjects`. So the lesson carries the teacher, and a composite foreign
 * key to `class_subjects (tenant_id, id, class_id, teacher_id, is_elective)` with
 * ON UPDATE CASCADE keeps the copy equal to the source: reassigning a subject to
 * another teacher moves every one of its lessons in the same statement, and if
 * the new teacher is already busy in one of those periods the unique index
 * refuses the whole reassignment, leaving nothing half changed.
 *
 * The cascade also reaches soft-deleted lessons, so a removed lesson shows the
 * subject's current teacher rather than the one it had. That history is not
 * something any read uses, and the alternative, a key that stops matching, would
 * make reassignment impossible for any subject with a removed lesson.
 */
export class CreateTimetables1757900000000 implements MigrationInterface {
  name = 'CreateTimetables1757900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /**
     * A period of the school week, in one session: "Tuesday P3, 09:20 to 10:00".
     *
     * Its own row per weekday rather than one daily bell schedule, because schools
     * do vary by day (a short Friday, an assembly on Monday). The weekday is ISO,
     * Monday 1 to Sunday 7, so a Saturday school is expressible.
     *
     * The overlap rule compares times on one fixed date, since Postgres has no
     * range type over `time`. Ranges are half open, so a period ending at 09:20
     * and the next starting at 09:20 do not overlap.
     */
    await queryRunner.query(`
      CREATE TABLE timetable_periods (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        session_id  uuid NOT NULL,
        weekday     smallint NOT NULL,
        label       citext NOT NULL,
        starts_at   time NOT NULL,
        ends_at     time NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz,
        deleted_by  uuid,
        archived_at timestamptz,
        CONSTRAINT timetable_periods_weekday_iso CHECK (weekday BETWEEN 1 AND 7),
        CONSTRAINT timetable_periods_times_ordered CHECK (starts_at < ends_at),
        CONSTRAINT timetable_periods_label_length CHECK (char_length(label) BETWEEN 1 AND 40),
        CONSTRAINT timetable_periods_tenant_id_unique UNIQUE (tenant_id, id),
        CONSTRAINT timetable_periods_tenant_id_session_unique UNIQUE (tenant_id, id, session_id),
        CONSTRAINT timetable_periods_session_fk FOREIGN KEY (tenant_id, session_id)
          REFERENCES academic_sessions (tenant_id, id),
        CONSTRAINT timetable_periods_no_overlap EXCLUDE USING gist (
          session_id WITH =,
          weekday WITH =,
          tsrange(DATE '2000-01-03' + starts_at, DATE '2000-01-03' + ends_at) WITH &&
        ) WHERE (deleted_at IS NULL)
      )
    `);

    // "Tuesday P3" has to name one period, or a clash message naming it is
    // ambiguous.
    await queryRunner.query(`
      CREATE UNIQUE INDEX timetable_periods_label_unique_live
      ON timetable_periods (session_id, weekday, label) WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('timetable_periods')`);

    // The key a lesson references so its teacher and electiveness can never
    // differ from its class subject's. A superset of the primary key, so it is
    // unique by construction and costs one index.
    await queryRunner.query(`
      ALTER TABLE class_subjects
        ADD CONSTRAINT class_subjects_lesson_key
        UNIQUE (tenant_id, id, class_id, teacher_id, is_elective)
    `);

    /**
     * A class subject taught in a period.
     *
     * `session_id`, `class_id`, `teacher_id` and `is_elective` are all copies,
     * and none of them can go wrong: each is pinned by a composite foreign key to
     * the row it was copied from. They are here because the clash rules below are
     * indexes and constraints on this table, which cannot see any other.
     */
    await queryRunner.query(`
      CREATE TABLE timetable_lessons (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        session_id        uuid NOT NULL,
        period_id         uuid NOT NULL,
        class_id          uuid NOT NULL,
        class_subject_id  uuid NOT NULL,
        teacher_id        uuid NOT NULL,
        is_elective       boolean NOT NULL,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        deleted_at        timestamptz,
        deleted_by        uuid,
        archived_at       timestamptz,
        CONSTRAINT timetable_lessons_tenant_id_unique UNIQUE (tenant_id, id),
        CONSTRAINT timetable_lessons_period_fk FOREIGN KEY (tenant_id, period_id, session_id)
          REFERENCES timetable_periods (tenant_id, id, session_id),
        CONSTRAINT timetable_lessons_class_fk FOREIGN KEY (tenant_id, class_id, session_id)
          REFERENCES classes (tenant_id, id, session_id),
        CONSTRAINT timetable_lessons_class_subject_fk
          FOREIGN KEY (tenant_id, class_subject_id, class_id, teacher_id, is_elective)
          REFERENCES class_subjects (tenant_id, id, class_id, teacher_id, is_elective)
          ON UPDATE CASCADE,
        CONSTRAINT timetable_lessons_core_excludes_elective EXCLUDE USING gist (
          class_id WITH =,
          period_id WITH =,
          is_elective WITH <>
        ) WHERE (deleted_at IS NULL)
      )
    `);

    // One core lesson per class per period. Electives are left out: they may run
    // in parallel, and the exclusion constraint above keeps them apart from core.
    await queryRunner.query(`
      CREATE UNIQUE INDEX timetable_lessons_class_core_unique
      ON timetable_lessons (class_id, period_id)
      WHERE deleted_at IS NULL AND NOT is_elective
    `);

    // One lesson per teacher per period. Leads with the teacher, so it is also
    // the index a teacher's timetable is read through.
    await queryRunner.query(`
      CREATE UNIQUE INDEX timetable_lessons_teacher_period_unique
      ON timetable_lessons (teacher_id, period_id) WHERE deleted_at IS NULL
    `);

    // The one index no clash rule gives for free, added because a plan asked for
    // it. Lessons are kept per session, so a school gains a year's worth every
    // September. The conflicts report reads one session's elective lessons and
    // has nothing else to start from, so without this it read every year's:
    // measured on five years of a forty-class school, all 10,000 lessons to
    // report on this year's 2,000.
    await queryRunner.query(`
      CREATE INDEX timetable_lessons_session_live_idx
      ON timetable_lessons (session_id) WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('timetable_lessons')`);

    /**
     * Removing a class subject removes its lessons.
     *
     * A subject no longer taught in a class cannot keep occupying that class's
     * periods and its teacher's, and leaving the lessons live would hold both
     * slots in the unique indexes above with nothing a reader could show for them.
     * Soft, with the same time and actor, so the lessons read as removed together
     * with the subject.
     */
    await queryRunner.query(`
      CREATE FUNCTION end_lessons_of_removed_class_subject() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE timetable_lessons
           SET deleted_at = NEW.deleted_at,
               deleted_by = NEW.deleted_by,
               updated_at = now()
         WHERE class_subject_id = NEW.id
           AND deleted_at IS NULL;

        RETURN NULL;
      END
      $$
    `);

    await queryRunner.query(`
      CREATE TRIGGER end_lessons_of_removed_class_subject
      AFTER UPDATE OF deleted_at ON class_subjects
      FOR EACH ROW
      WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
      EXECUTE FUNCTION end_lessons_of_removed_class_subject()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS end_lessons_of_removed_class_subject ON class_subjects`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS end_lessons_of_removed_class_subject()`);
    await queryRunner.query(`DROP TABLE IF EXISTS timetable_lessons`);
    await queryRunner.query(
      `ALTER TABLE class_subjects DROP CONSTRAINT IF EXISTS class_subjects_lesson_key`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS timetable_periods`);
  }
}
