import type { EntityManager } from 'typeorm';

import { Role } from '../auth/permission.matrix';
import { type AccessScope, unrestrictedScope } from '../common/actions/access-scope';
import { TenantScopedAction } from '../common/actions/tenant-scoped.action';
import { Result } from './result.entity';

export type AssessmentType = 'CA1' | 'CA2' | 'EXAM';

/** What each assessment is out of, so every subject total is out of 100. */
export const MAX_SCORE: Readonly<Record<AssessmentType, number>> = Object.freeze({
  CA1: 20,
  CA2: 20,
  EXAM: 60,
});

/** A class subject, with what entering its scores needs to know. */
export interface ClassSubjectRef {
  readonly id: string;
  readonly classId: string;
  readonly subjectId: string;
  readonly sessionId: string;
  readonly isElective: boolean;
  readonly isCurrentSession: boolean;
  readonly subject: string;
  readonly className: string;
}

/** A pupil who takes a class subject, and the enrolment their scores hang from. */
export interface SheetPupil {
  readonly studentId: string;
  readonly enrolmentId: string;
  readonly name: string;
}

export interface SheetScore {
  readonly studentId: string;
  readonly assessmentType: AssessmentType;
  readonly score: number;
}

export interface ScoreToSave {
  readonly studentId: string;
  readonly enrolmentId: string;
  readonly score: number;
  readonly remarks: string | null;
}

/**
 * Entering a class subject's scores.
 *
 * ## The access scope here is unrestricted, and that is not an omission
 *
 * Like `MarkAttendanceAction`, its reads are authorization lookups and the
 * roster of one class subject, each carrying the tenant explicitly and running
 * under row-level security. Who may enter scores for a class subject is
 * `mayEnter`, checked before anything else is read. Its writes are held to the
 * constraints in CreateResults: the enrolment, term and class subject keys, the
 * score range and one score per assessment.
 */
export class EnterScoresAction extends TenantScopedAction<Result> {
  constructor(manager: EntityManager) {
    super(manager, Result);
  }

  protected readonly accessScope: AccessScope<Result> = unrestrictedScope<Result>();

  /** A class subject of this school, or null. */
  async classSubject(classSubjectId: string): Promise<ClassSubjectRef | null> {
    const rows = await this.manager.query<
      Array<{
        id: string;
        class_id: string;
        subject_id: string;
        session_id: string;
        is_elective: boolean;
        is_current: boolean;
        subject: string;
        class_name: string;
      }>
    >(
      `SELECT cs.id, cs.class_id, cs.subject_id, klass.session_id, cs.is_elective,
              session.is_current, subject.name AS subject,
              grade.name || ' ' || klass.arm AS class_name
         FROM class_subjects cs
         JOIN classes klass ON klass.id = cs.class_id AND klass.deleted_at IS NULL
         JOIN academic_sessions session ON session.id = klass.session_id AND session.deleted_at IS NULL
         JOIN grade_levels grade ON grade.id = klass.grade_level_id
         JOIN subjects subject ON subject.id = cs.subject_id
        WHERE cs.tenant_id = $1 AND cs.id = $2 AND cs.deleted_at IS NULL`,
      [this.tenantId, classSubjectId],
    );
    const row = rows[0];

    return row
      ? {
          id: row.id,
          classId: row.class_id,
          subjectId: row.subject_id,
          sessionId: row.session_id,
          isElective: row.is_elective,
          isCurrentSession: row.is_current,
          subject: row.subject,
          className: row.class_name,
        }
      : null;
  }

  /**
   * Whether this caller may enter scores for a class subject.
   *
   * An administrator may. A teacher may when the class subject is theirs, held
   * through a live, active membership, in the current session. Supervising the
   * class is not enough: a form teacher does not enter the Physics teacher's
   * scores.
   */
  async mayEnter(classSubject: ClassSubjectRef): Promise<boolean> {
    const actor = this.actor;

    if (actor.roles.has(Role.SchoolAdmin)) {
      return true;
    }

    if (!actor.roles.has(Role.Teacher) || !classSubject.isCurrentSession) {
      return false;
    }

    const rows = await this.manager.query<Array<{ held: boolean }>>(
      `SELECT EXISTS (
         SELECT 1
           FROM class_subjects cs
           JOIN teachers teacher ON teacher.id = cs.teacher_id AND teacher.deleted_at IS NULL
           JOIN memberships membership
             ON membership.id = teacher.membership_id
            AND membership.deleted_at IS NULL
            AND membership.status = 'ACTIVE'
            AND membership.user_id = $3
          WHERE cs.tenant_id = $1 AND cs.id = $2
       ) AS held`,
      [this.tenantId, classSubject.id, actor.userId],
    );

    return rows[0]?.held === true;
  }

  /** A term of this school, with the session it belongs to, or null. */
  async term(termId: string): Promise<{ id: string; name: string; sessionId: string } | null> {
    const rows = await this.manager.query<Array<{ id: string; name: string; session_id: string }>>(
      `SELECT id, name, session_id FROM terms
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [this.tenantId, termId],
    );
    const row = rows[0];

    return row ? { id: row.id, name: row.name, sessionId: row.session_id } : null;
  }

  /**
   * The pupils who take a class subject: everyone enrolled in the class for a
   * core subject, only those registered for an elective.
   */
  async roster(classSubject: ClassSubjectRef): Promise<SheetPupil[]> {
    const rows = await this.manager.query<
      Array<{ student_id: string; enrolment_id: string; name: string }>
    >(
      `SELECT student.id AS student_id, enrolment.id AS enrolment_id,
              student.first_name || ' ' || student.last_name AS name
         FROM class_enrolments enrolment
         JOIN students student ON student.id = enrolment.student_id AND student.deleted_at IS NULL
        WHERE enrolment.tenant_id = $1
          AND enrolment.class_id = $2
          AND enrolment.session_id = $3
          AND enrolment.deleted_at IS NULL
          AND (NOT $4::boolean OR EXISTS (
                SELECT 1 FROM elective_registrations registration
                 WHERE registration.class_subject_id = $5
                   AND registration.student_id = student.id
                   AND registration.deleted_at IS NULL))
        ORDER BY student.last_name, student.first_name`,
      [
        this.tenantId,
        classSubject.classId,
        classSubject.sessionId,
        classSubject.isElective,
        classSubject.id,
      ],
    );

    return rows.map((row) => ({
      studentId: row.student_id,
      enrolmentId: row.enrolment_id,
      name: row.name,
    }));
  }

  /** Every recorded score of a class subject in a term. */
  async scores(classSubjectId: string, termId: string): Promise<SheetScore[]> {
    const rows = await this.manager.query<
      Array<{ student_id: string; assessment_type: AssessmentType; score: string }>
    >(
      `SELECT student_id, assessment_type, score
         FROM results
        WHERE tenant_id = $1 AND class_subject_id = $2 AND term_id = $3 AND deleted_at IS NULL`,
      [this.tenantId, classSubjectId, termId],
    );

    return rows.map((row) => ({
      studentId: row.student_id,
      assessmentType: row.assessment_type,
      score: Number(row.score),
    }));
  }

  /** The acting person's active membership of this school: what `recorded_by` stores. */
  async actingMembershipId(): Promise<string | null> {
    const rows = await this.manager.query<Array<{ id: string }>>(
      `SELECT id FROM memberships
        WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL AND status = 'ACTIVE'
        LIMIT 1`,
      [this.tenantId, this.actor.userId],
    );

    return rows[0]?.id ?? null;
  }

  /**
   * Writes one assessment's scores in one statement: new ones inserted, existing
   * ones corrected in place.
   *
   * The conflict target is the partial unique index `results_one_per_assessment`,
   * so a live score is updated rather than duplicated, and a correction records
   * who made it. Returns how many rows were inserted and how many updated.
   */
  async upsert(options: {
    readonly classSubject: ClassSubjectRef;
    readonly termId: string;
    readonly assessmentType: AssessmentType;
    readonly assessedOn: string | null;
    readonly recordedBy: string;
    readonly entries: readonly ScoreToSave[];
  }): Promise<{ inserted: number; updated: number }> {
    const { classSubject, termId, assessmentType, assessedOn, recordedBy, entries } = options;

    // $1..$10 are shared by every row; each entry then binds four more.
    const fixed = [
      this.tenantId,
      classSubject.classId,
      classSubject.sessionId,
      termId,
      classSubject.id,
      classSubject.subjectId,
      assessmentType,
      MAX_SCORE[assessmentType],
      assessedOn,
      recordedBy,
    ];
    const values: unknown[] = [];
    const rows = entries.map((entry, index) => {
      const base = fixed.length + index * 4;

      values.push(entry.studentId, entry.enrolmentId, entry.score, entry.remarks);

      return `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::numeric, $${base + 4}::text)`;
    });

    const written = await this.manager.query<Array<{ inserted: boolean }>>(
      `INSERT INTO results
         (tenant_id, student_id, enrolment_id, class_id, session_id, term_id, class_subject_id,
          subject_id, assessment_type, score, max_score, assessed_on, remarks, recorded_by)
       SELECT $1, entry.student_id, entry.enrolment_id, $2, $3, $4, $5, $6,
              $7::assessment_type_enum, entry.score, $8, COALESCE($9::date, CURRENT_DATE),
              entry.remarks, $10
         FROM (VALUES ${rows.join(', ')}) AS entry(student_id, enrolment_id, score, remarks)
       ON CONFLICT (enrolment_id, class_subject_id, term_id, assessment_type)
         WHERE deleted_at IS NULL
       DO UPDATE SET score = EXCLUDED.score,
                     remarks = EXCLUDED.remarks,
                     assessed_on = EXCLUDED.assessed_on,
                     recorded_by = EXCLUDED.recorded_by,
                     updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [...fixed, ...values],
    );

    const inserted = written.filter((row) => row.inserted).length;

    return { inserted, updated: written.length - inserted };
  }
}
