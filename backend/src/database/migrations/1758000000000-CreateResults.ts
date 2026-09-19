import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assessment results: each pupil's score in each subject, per term and
 * assessment, blueprint Phase 6 and the hackathon plan's "results foundation".
 *
 * One row per pupil, subject, term and assessment (CA1, CA2 or the exam), with
 * the score and what it was out of. A total is not stored: it is the sum of the
 * rows, computed where it is read, so a corrected CA score can never leave a
 * stale total behind.
 *
 * Every reference is to the school's existing structure, not a copy of it:
 * - the enrolment, through `(tenant_id, enrolment_id, class_id, session_id,
 *   student_id)`, so a result can only belong to a pupil really enrolled in
 *   that class that year;
 * - the term, through `(tenant_id, term_id, session_id)`, so it is a term of
 *   that same year;
 * - the class subject, through `(tenant_id, class_subject_id, class_id,
 *   subject_id)`, so the subject is one actually taught in that class.
 */
export class CreateResults1758000000000 implements MigrationInterface {
  name = 'CreateResults1758000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE assessment_type_enum AS ENUM ('CA1', 'CA2', 'EXAM')`);

    // The key a result references so its class and subject are always its class
    // subject's. A superset of the primary key, so unique by construction.
    await queryRunner.query(`
      ALTER TABLE class_subjects
        ADD CONSTRAINT class_subjects_result_key UNIQUE (tenant_id, id, class_id, subject_id)
    `);

    await queryRunner.query(`
      CREATE TABLE results (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id        uuid NOT NULL,
        enrolment_id      uuid NOT NULL,
        class_id          uuid NOT NULL,
        session_id        uuid NOT NULL,
        term_id           uuid NOT NULL,
        class_subject_id  uuid NOT NULL,
        subject_id        uuid NOT NULL,
        assessment_type   assessment_type_enum NOT NULL,
        score             numeric(5, 2) NOT NULL,
        max_score         numeric(5, 2) NOT NULL,
        assessed_on       date NOT NULL,
        remarks           text,
        recorded_by       uuid NOT NULL,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        deleted_at        timestamptz,
        deleted_by        uuid,
        archived_at       timestamptz,
        CONSTRAINT results_score_in_range CHECK (max_score > 0 AND score >= 0 AND score <= max_score),
        CONSTRAINT results_remarks_length CHECK (remarks IS NULL OR char_length(remarks) <= 500),
        CONSTRAINT results_student_fk FOREIGN KEY (tenant_id, student_id)
          REFERENCES students (tenant_id, id),
        CONSTRAINT results_enrolment_fk
          FOREIGN KEY (tenant_id, enrolment_id, class_id, session_id, student_id)
          REFERENCES class_enrolments (tenant_id, id, class_id, session_id, student_id),
        CONSTRAINT results_term_fk FOREIGN KEY (tenant_id, term_id, session_id)
          REFERENCES terms (tenant_id, id, session_id),
        CONSTRAINT results_class_subject_fk
          FOREIGN KEY (tenant_id, class_subject_id, class_id, subject_id)
          REFERENCES class_subjects (tenant_id, id, class_id, subject_id),
        CONSTRAINT results_recorded_by_fk FOREIGN KEY (tenant_id, recorded_by)
          REFERENCES memberships (tenant_id, id)
      )
    `);

    // One score per pupil, subject, term and assessment.
    await queryRunner.query(`
      CREATE UNIQUE INDEX results_one_per_assessment
      ON results (enrolment_id, class_subject_id, term_id, assessment_type)
      WHERE deleted_at IS NULL
    `);
    // A class's term, which is what the performance read and the Copilot ask for.
    await queryRunner.query(`
      CREATE INDEX results_class_term_idx
      ON results (class_id, term_id) WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX results_student_idx ON results (student_id) WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('results')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS results`);
    await queryRunner.query(
      `ALTER TABLE class_subjects DROP CONSTRAINT IF EXISTS class_subjects_result_key`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS assessment_type_enum`);
  }
}
