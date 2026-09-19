import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { Role, toRoles } from '../auth/permission.matrix';
import { type AccessScope, scopeFor } from '../common/actions/access-scope';
import { TenantScopedAction } from '../common/actions/tenant-scoped.action';
import {
  ForbiddenException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '../common/exceptions/app.exception';
import { Student } from '../people/entities/student.entity';
import { studentScope } from '../people/student-access.scope';
import { getRequestContext, requireTenantId, requireUserId } from '../tenancy/request-context';
import { TenantTransactionService } from '../tenancy/tenant-transaction.service';
import {
  type ClassSubjectRef,
  EnterScoresAction,
  MAX_SCORE,
  type SheetPupil,
} from './enter-scores.action';
import { Result } from './result.entity';
import type {
  PerformanceDto,
  PerformanceQueryDto,
  SavedScoresDto,
  SaveScoresDto,
  ScoreSheetDto,
  SheetOptionDto,
  ScoreSheetQueryDto,
  StudentPerformanceDto,
  SubjectSummaryDto,
} from './results.dto';

interface ScoreRow {
  student_id: string;
  subject_id: string;
  subject_name: string;
  assessment_type: 'CA1' | 'CA2' | 'EXAM';
  score: string;
}

interface ScoreEntry {
  subject: string;
  ca1: number | null;
  ca2: number | null;
  exam: number | null;
}

interface PupilRow {
  student_id: string;
  name: string;
  class_name: string;
}

/** Scores the caller may see: the student scope, applied to each result's pupil. */
class ReadResultsAction extends TenantScopedAction<Result> {
  protected readonly accessScope: AccessScope<Result> = studentScope<Result>('studentId');

  constructor(manager: EntityManager) {
    super(manager, Result);
  }

  scores(termId: string, filter: PerformanceQueryDto): Promise<ScoreRow[]> {
    const query = this.scopedQuery('result')
      .innerJoin('subjects', 'subject', 'subject.id = result.subjectId')
      .select('result.studentId', 'student_id')
      .addSelect('result.subjectId', 'subject_id')
      .addSelect('subject.name', 'subject_name')
      .addSelect('result.assessmentType', 'assessment_type')
      .addSelect('result.score', 'score')
      .andWhere('result.deletedAt IS NULL')
      .andWhere('result.termId = :termId', { termId });

    if (filter.classId) query.andWhere('result.classId = :classId', { classId: filter.classId });
    if (filter.subjectId)
      query.andWhere('result.subjectId = :subjectId', { subjectId: filter.subjectId });
    if (filter.studentId)
      query.andWhere('result.studentId = :studentId', { studentId: filter.studentId });

    return query.getRawMany<ScoreRow>();
  }
}

/**
 * Pupils enrolled in the session the caller may see, so a pupil with no results
 * yet still appears, with none. Same student scope as the scores.
 */
class ReadEnrolledPupilsAction extends TenantScopedAction<Student> {
  protected readonly accessScope: AccessScope<Student> = studentScope<Student>('id');

  constructor(manager: EntityManager) {
    super(manager, Student);
  }

  pupils(sessionId: string, filter: PerformanceQueryDto): Promise<PupilRow[]> {
    const query = this.scopedQuery('student')
      .innerJoin(
        'class_enrolments',
        'enrolment',
        'enrolment.student_id = student.id AND enrolment.deleted_at IS NULL',
      )
      .innerJoin('classes', 'klass', 'klass.id = enrolment.class_id')
      .innerJoin('grade_levels', 'grade', 'grade.id = klass.grade_level_id')
      .select('student.id', 'student_id')
      .addSelect(`student.first_name || ' ' || student.last_name`, 'name')
      .addSelect(`grade.name || ' ' || klass.arm`, 'class_name')
      .andWhere('enrolment.session_id = :sessionId', { sessionId })
      .orderBy('student.last_name', 'ASC')
      .addOrderBy('student.first_name', 'ASC');

    if (filter.classId)
      query.andWhere('enrolment.class_id = :classId', { classId: filter.classId });
    if (filter.studentId)
      query.andWhere('student.id = :studentId', { studentId: filter.studentId });

    return query.getRawMany<PupilRow>();
  }
}

/** A scope that only an administrator passes: who may see attendance rates here. */
const adminOnly = scopeFor<object>({ unrestrictedRoles: [Role.SchoolAdmin], byRole: {} });

const round1 = (value: number) => Math.round(value * 10) / 10;

/** A subject total, rounded so decimal scores add up without floating point noise. */
const total = (entry: { ca1: number | null; ca2: number | null; exam: number | null }) =>
  Math.round(((entry.ca1 ?? 0) + (entry.ca2 ?? 0) + (entry.exam ?? 0)) * 100) / 100;

/**
 * Results, read for performance: each pupil's CA1, CA2, exam and total per
 * subject in a term, and each subject's summary.
 *
 * Totals and averages are computed here from the stored scores, never stored,
 * so a corrected score cannot leave a stale total behind. This is also the one
 * place the Admin Copilot gets its data from, so the AI only ever sees what this
 * caller is already authorized to see.
 */
@Injectable()
export class ResultsService {
  constructor(private readonly transactions: TenantTransactionService) {}

  performance(filter: PerformanceQueryDto): Promise<PerformanceDto> {
    return this.inSchool((manager) => this.performanceIn(manager, filter));
  }

  /** The same read, inside a caller's transaction. Used by the Copilot. */
  async performanceIn(
    manager: EntityManager,
    filter: PerformanceQueryDto,
  ): Promise<PerformanceDto> {
    const session = await this.session(manager, filter.sessionId);
    const term = await this.term(manager, session.id, filter.termId);
    const klass = filter.classId ? await this.klass(manager, filter.classId) : null;

    const [pupils, scores] = await Promise.all([
      new ReadEnrolledPupilsAction(manager).pupils(session.id, filter),
      new ReadResultsAction(manager).scores(term.id, filter),
    ]);
    const attendance = this.mayReadAttendance()
      ? await this.attendanceRates(
          manager,
          term.id,
          pupils.map((pupil) => pupil.student_id),
        )
      : new Map<string, number>();

    const byPupil = new Map<string, Map<string, ScoreEntry>>();

    for (const row of scores) {
      const subjects = byPupil.get(row.student_id) ?? new Map<string, ScoreEntry>();
      const entry: ScoreEntry = subjects.get(row.subject_id) ?? {
        subject: row.subject_name,
        ca1: null,
        ca2: null,
        exam: null,
      };
      const value = Number(row.score);

      if (row.assessment_type === 'CA1') entry.ca1 = value;
      if (row.assessment_type === 'CA2') entry.ca2 = value;
      if (row.assessment_type === 'EXAM') entry.exam = value;
      subjects.set(row.subject_id, entry);
      byPupil.set(row.student_id, subjects);
    }

    const students: StudentPerformanceDto[] = pupils.map((pupil) => {
      const subjects = [
        ...(byPupil.get(pupil.student_id) ?? new Map<string, ScoreEntry>()).entries(),
      ]
        .map(([subjectId, entry]) => ({
          subjectId,
          ...entry,
          total: total(entry),
        }))
        .sort((a, b) => a.subject.localeCompare(b.subject));

      return {
        studentId: pupil.student_id,
        name: pupil.name,
        class: pupil.class_name,
        attendanceRate: attendance.get(pupil.student_id) ?? null,
        average: subjects.length
          ? round1(subjects.reduce((sum, s) => sum + s.total, 0) / subjects.length)
          : null,
        subjects,
      };
    });

    const summaries = new Map<string, { subject: string; totals: number[] }>();

    for (const student of students) {
      for (const subject of student.subjects) {
        const summary = summaries.get(subject.subjectId) ?? {
          subject: subject.subject,
          totals: [],
        };
        summary.totals.push(subject.total);
        summaries.set(subject.subjectId, summary);
      }
    }

    const subjects: SubjectSummaryDto[] = [...summaries.entries()]
      .map(([subjectId, { subject, totals }]) => ({
        subjectId,
        subject,
        average: round1(totals.reduce((sum, total) => sum + total, 0) / totals.length),
        highest: Math.max(...totals),
        lowest: Math.min(...totals),
        below50: totals.filter((total) => total < 50).length,
        students: totals.length,
      }))
      .sort((a, b) => a.subject.localeCompare(b.subject));

    return {
      session: { id: session.id, name: session.name },
      term,
      class: klass,
      subjects,
      students,
    };
  }

  /** The score sheets this caller may open in the current session. */
  sheets(): Promise<SheetOptionDto[]> {
    return this.inSchool(async (manager) =>
      (await new EnterScoresAction(manager).enterable()).map((option) => ({
        classSubjectId: option.classSubjectId,
        subject: option.subject,
        class: option.className,
        terms: option.terms,
      })),
    );
  }

  /** A class subject's score sheet for a term: every pupil who takes it, scored or not. */
  sheet(query: ScoreSheetQueryDto): Promise<ScoreSheetDto> {
    return this.inSchool(async (manager) => {
      const entering = new EnterScoresAction(manager);
      const { classSubject, term } = await this.sheetContext(entering, query);

      return this.buildSheet(entering, classSubject, term, await entering.roster(classSubject));
    });
  }

  /**
   * Saves one assessment's scores for a class subject in a term.
   *
   * The checks run in the same order as taking a register: the class subject,
   * then the caller's right to it, then the term, then the entries. A caller who
   * may not enter a class subject's scores learns nothing about its pupils.
   * Everything is written in one statement inside the request's transaction, so
   * a refused entry leaves nothing behind.
   */
  save(dto: SaveScoresDto): Promise<SavedScoresDto> {
    return this.inSchool(async (manager) => {
      const entering = new EnterScoresAction(manager);
      const { classSubject, term } = await this.sheetContext(entering, dto);
      const max = MAX_SCORE[dto.assessmentType];
      const studentIds = dto.entries.map((entry) => entry.studentId);

      if (new Set(studentIds).size !== studentIds.length) {
        throw new ValidationFailedException(['entries must not name the same pupil twice']);
      }

      const over = dto.entries.filter((entry) => entry.score > max);

      if (over.length > 0) {
        throw new ValidationFailedException([
          `${dto.assessmentType} is out of ${max}. Over it: ${over.map((e) => e.studentId).join(', ')}.`,
        ]);
      }

      const roster = await entering.roster(classSubject);
      const enrolments = new Map(roster.map((pupil) => [pupil.studentId, pupil.enrolmentId]));
      const outside = studentIds.filter((studentId) => !enrolments.has(studentId));

      if (outside.length > 0) {
        throw new ValidationFailedException([
          `Not taking ${classSubject.subject} in ${classSubject.className}: ${outside.join(', ')}.`,
        ]);
      }

      const recordedBy = await entering.actingMembershipId();

      if (recordedBy === null) {
        throw new ForbiddenException('Only an active member of the school can enter scores.');
      }

      const counts = await entering.upsert({
        classSubject,
        termId: term.id,
        assessmentType: dto.assessmentType,
        assessedOn: dto.assessedOn ?? null,
        recordedBy,
        entries: dto.entries.map((entry) => ({
          studentId: entry.studentId,
          enrolmentId: enrolments.get(entry.studentId)!,
          score: entry.score,
          remarks: entry.remarks ?? null,
        })),
      });

      return {
        ...(await this.buildSheet(entering, classSubject, term, roster)),
        assessmentType: dto.assessmentType,
        ...counts,
      };
    });
  }

  /** The class subject and term of a sheet, once the caller may use them. */
  private async sheetContext(entering: EnterScoresAction, query: ScoreSheetQueryDto) {
    const classSubject = await entering.classSubject(query.classSubjectId);

    if (classSubject === null) {
      throw new ResourceNotFoundException();
    }

    if (!(await entering.mayEnter(classSubject))) {
      throw new ForbiddenException(
        'You can only enter scores for a subject you teach in the current session.',
      );
    }

    const term = await entering.term(query.termId);

    if (term === null) {
      throw new ResourceNotFoundException();
    }

    if (term.sessionId !== classSubject.sessionId) {
      throw new ValidationFailedException([
        `${term.name} is not a term of ${classSubject.className}'s session.`,
      ]);
    }

    return { classSubject, term };
  }

  private async buildSheet(
    entering: EnterScoresAction,
    classSubject: ClassSubjectRef,
    term: { id: string; name: string },
    roster: readonly SheetPupil[],
  ): Promise<ScoreSheetDto> {
    const scores = await entering.scores(classSubject.id, term.id);
    const byPupil = new Map<
      string,
      { ca1: number | null; ca2: number | null; exam: number | null }
    >();

    for (const score of scores) {
      const row = byPupil.get(score.studentId) ?? { ca1: null, ca2: null, exam: null };

      if (score.assessmentType === 'CA1') row.ca1 = score.score;
      if (score.assessmentType === 'CA2') row.ca2 = score.score;
      if (score.assessmentType === 'EXAM') row.exam = score.score;
      byPupil.set(score.studentId, row);
    }

    return {
      classSubjectId: classSubject.id,
      subject: classSubject.subject,
      class: classSubject.className,
      term: { id: term.id, name: term.name },
      maxScores: { ca1: MAX_SCORE.CA1, ca2: MAX_SCORE.CA2, exam: MAX_SCORE.EXAM },
      pupils: roster.map((pupil) => {
        const row = byPupil.get(pupil.studentId) ?? { ca1: null, ca2: null, exam: null };

        return {
          studentId: pupil.studentId,
          name: pupil.name,
          ...row,
          total: total(row),
        };
      }),
    };
  }

  private inSchool<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.transactions.runInUserAndTenantContext(requireUserId(), requireTenantId(), work);
  }

  private mayReadAttendance(): boolean {
    const roles = toRoles(getRequestContext()?.roles);

    return !adminOnly.narrows({ userId: requireUserId(), roles });
  }

  private async session(manager: EntityManager, sessionId: string | undefined) {
    const [row] = await manager.query<Array<{ id: string; name: string }>>(
      sessionId
        ? `SELECT id, name FROM academic_sessions WHERE id = $1 AND deleted_at IS NULL`
        : `SELECT id, name FROM academic_sessions WHERE is_current AND deleted_at IS NULL`,
      sessionId ? [sessionId] : [],
    );

    if (!row) {
      if (sessionId) throw new ResourceNotFoundException();
      throw new ValidationFailedException([
        'The school has no current session. Pass sessionId to choose one.',
      ]);
    }

    return row;
  }

  /** The named term, or the latest term of the session with results, or its latest term. */
  private async term(manager: EntityManager, sessionId: string, termId: string | undefined) {
    const [row] = await manager.query<
      Array<{ id: string; name: string; startsOn: string; endsOn: string }>
    >(
      `SELECT t.id, t.name,
              to_char(t.starts_on, 'YYYY-MM-DD') AS "startsOn",
              to_char(t.ends_on, 'YYYY-MM-DD') AS "endsOn"
         FROM terms t
        WHERE t.session_id = $1 AND t.deleted_at IS NULL
          AND ($2::uuid IS NULL OR t.id = $2::uuid)
        ORDER BY EXISTS (SELECT 1 FROM results r WHERE r.term_id = t.id AND r.deleted_at IS NULL) DESC,
                 t.starts_on DESC
        LIMIT 1`,
      [sessionId, termId ?? null],
    );

    if (!row) {
      if (termId) throw new ResourceNotFoundException();
      throw new ValidationFailedException(['The session has no terms yet.']);
    }

    return row;
  }

  private async klass(manager: EntityManager, classId: string) {
    const [row] = await manager.query<Array<{ id: string; name: string }>>(
      `SELECT c.id, g.name || ' ' || c.arm AS name
         FROM classes c JOIN grade_levels g ON g.id = c.grade_level_id
        WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [classId],
    );

    if (!row) throw new ResourceNotFoundException();

    return row;
  }

  /** Percent of each pupil's recorded days in the term marked present or late. */
  private async attendanceRates(manager: EntityManager, termId: string, studentIds: string[]) {
    if (studentIds.length === 0) return new Map<string, number>();

    const rows = await manager.query<Array<{ student_id: string; rate: string }>>(
      `SELECT student_id,
              round(100.0 * count(*) FILTER (WHERE status IN ('PRESENT', 'LATE')) / count(*), 1) AS rate
         FROM attendance
        WHERE term_id = $1 AND student_id = ANY($2::uuid[]) AND deleted_at IS NULL
        GROUP BY student_id`,
      [termId, studentIds],
    );

    return new Map(rows.map((row) => [row.student_id, Number(row.rate)]));
  }
}
