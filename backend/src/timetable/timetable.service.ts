import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { AcademicSession } from '../academics/entities/academic-session.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { SchoolClass } from '../academics/entities/school-class.entity';
import { RecordAction } from '../common/actions/record.action';
import {
  ResourceConflictException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '../common/exceptions/app.exception';
import { Teacher } from '../people/entities/teacher.entity';
import { requireTenantId, requireUserId } from '../tenancy/request-context';
import { TenantTransactionService } from '../tenancy/tenant-transaction.service';
import { TimetableLesson } from './entities/timetable-lesson.entity';
import { TimetablePeriod } from './entities/timetable-period.entity';
import { myTimetableScope } from './my-timetable.scope';
import { ReadTimetableAction } from './read-timetable.action';
import { lessonClash } from './timetable-clashes';
import type {
  CreateLessonDto,
  CreatePeriodDto,
  LessonDto,
  MoveLessonDto,
  PeriodDto,
  TimetableConflictDto,
  UpdatePeriodDto,
} from './timetable.dto';
import { weekdayName } from './weekdays';

/** Refused when a read needs a session, none was named, and the school has no current one. */
export const NO_CURRENT_SESSION =
  'The school has no current session. Pass sessionId to choose which session to read.';

/** Refused when a lesson and a period come from different school years. */
export const PERIOD_IN_ANOTHER_SESSION =
  "The period belongs to a different session from the lesson's class. A lesson can only be " +
  'timetabled in a period of its own session.';

/**
 * Class timetables: periods, lessons, and the weeks they make.
 *
 * Writes are an administrator's, one lesson at a time. Each clash is looked for
 * first so the 409 can name it, and the constraints on `timetable_lessons` refuse
 * it regardless, so two administrators racing the same slot still cannot both
 * win. Reads are every member's: any class's week, any teacher's week, and the
 * caller's own.
 *
 * Nothing here is cached. A timetable is at most a few hundred rows read through
 * indexes, measured in the performance suite, and it changes through five
 * different writes, three of them outside this module (a class subject changing
 * teacher, an elective registration, an enrolment). A cache would need all of
 * them to invalidate it, and a stale timetable sends a class to the wrong room.
 */
@Injectable()
export class TimetableService {
  constructor(private readonly transactions: TenantTransactionService) {}

  // -------------------------------------------------------------------------
  // Periods
  // -------------------------------------------------------------------------

  listPeriods(sessionId: string | undefined): Promise<PeriodDto[]> {
    return this.inSchool(async (manager) => {
      const session = await this.sessionOrCurrent(manager, sessionId);

      if (session === null) {
        throw new ValidationFailedException([NO_CURRENT_SESSION]);
      }

      const periods = await manager.find(TimetablePeriod, {
        where: { sessionId: session },
        order: { weekday: 'ASC', startsAt: 'ASC' },
      });

      return periods.map(toPeriodDto);
    });
  }

  createPeriod(input: CreatePeriodDto): Promise<PeriodDto> {
    return this.inSchool(async (manager) => {
      await this.refusePeriodClash(manager, { ...input });

      const period = await new RecordAction(manager, TimetablePeriod, 'period').create(input);

      return toPeriodDto(period);
    });
  }

  /**
   * Changes a period's day, label or times. Its lessons stay in it, so they move
   * with it, and the clash rules on lessons are untouched: they are keyed on the
   * period, not on its times.
   */
  updatePeriod(id: string, input: UpdatePeriodDto): Promise<PeriodDto> {
    return this.inSchool(async (manager) => {
      const periods = new RecordAction(manager, TimetablePeriod, 'period');
      const existing = await periods.findById(id);

      if (!existing) {
        throw new ResourceNotFoundException();
      }

      await this.refusePeriodClash(manager, { ...existing, ...input, id });

      const updated = await periods.update(id, input);

      return toPeriodDto(updated!);
    });
  }

  /**
   * Removes a period that holds no lessons.
   *
   * Refused while it has any, rather than taking them with it: removing
   * "Tuesday P3" should never silently empty that slot for forty classes. The
   * period is locked first, and placing a lesson locks it for share, so a lesson
   * cannot land in it between the count and the removal.
   */
  removePeriod(id: string): Promise<void> {
    return this.inSchool(async (manager) => {
      const period = await this.lockPeriod(manager, id, 'pessimistic_write');
      const lessons = await manager.count(TimetableLesson, { where: { periodId: id } });

      if (lessons > 0) {
        throw new ResourceConflictException(
          `${weekdayName(period.weekday)} ${period.label} still has ${lessons} ` +
            `lesson${lessons === 1 ? '' : 's'}. Move or remove ${lessons === 1 ? 'it' : 'them'} first.`,
        );
      }

      await new RecordAction(manager, TimetablePeriod, 'period').softRemove(id);
    });
  }

  // -------------------------------------------------------------------------
  // Lessons
  // -------------------------------------------------------------------------

  /**
   * Places a class subject in a period.
   *
   * The class, teacher and electiveness are taken from the class subject and the
   * session from the period, never from the caller.
   */
  createLesson(input: CreateLessonDto): Promise<LessonDto> {
    return this.inSchool(async (manager) => {
      const period = await this.lockPeriod(manager, input.periodId, 'pessimistic_read');
      const assignment = await manager.findOne(ClassSubject, {
        where: { id: input.classSubjectId },
      });

      if (!assignment) {
        throw new ResourceNotFoundException();
      }

      // A class subject can outlive its class's removal; its lessons cannot.
      const schoolClass = await manager.findOne(SchoolClass, {
        where: { id: assignment.classId },
      });

      if (!schoolClass) {
        throw new ResourceNotFoundException();
      }

      if (schoolClass.sessionId !== period.sessionId) {
        throw new ValidationFailedException([PERIOD_IN_ANOTHER_SESSION]);
      }

      await this.refuseLessonClash(manager, {
        periodId: period.id,
        classId: assignment.classId,
        teacherId: assignment.teacherId,
        isElective: assignment.isElective,
      });

      const lesson = await new RecordAction(manager, TimetableLesson, 'lesson').create({
        sessionId: period.sessionId,
        periodId: period.id,
        classId: assignment.classId,
        classSubjectId: assignment.id,
        teacherId: assignment.teacherId,
        isElective: assignment.isElective,
      });

      return this.readLesson(manager, lesson.id);
    });
  }

  /** Moves a lesson to another period of its session. */
  moveLesson(id: string, input: MoveLessonDto): Promise<LessonDto> {
    return this.inSchool(async (manager) => {
      const lesson = await manager.findOne(TimetableLesson, { where: { id } });

      if (!lesson) {
        throw new ResourceNotFoundException();
      }

      const period = await this.lockPeriod(manager, input.periodId, 'pessimistic_read');

      if (period.sessionId !== lesson.sessionId) {
        throw new ValidationFailedException([PERIOD_IN_ANOTHER_SESSION]);
      }

      await this.refuseLessonClash(manager, {
        periodId: period.id,
        classId: lesson.classId,
        teacherId: lesson.teacherId,
        isElective: lesson.isElective,
        movingLessonId: lesson.id,
      });

      await manager.update(TimetableLesson, { id: lesson.id }, { periodId: period.id });

      return this.readLesson(manager, lesson.id);
    });
  }

  removeLesson(id: string): Promise<void> {
    return this.inSchool(async (manager) => {
      const removed = await new RecordAction(manager, TimetableLesson, 'lesson').softRemove(id);

      if (!removed) {
        throw new ResourceNotFoundException();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Weeks
  // -------------------------------------------------------------------------

  /** A class's week. The class fixes the session, since a class belongs to one. */
  classTimetable(classId: string): Promise<LessonDto[]> {
    return this.inSchool(async (manager) => {
      const schoolClass = await manager.findOne(SchoolClass, { where: { id: classId } });

      if (!schoolClass) {
        throw new ResourceNotFoundException();
      }

      return new ReadTimetableAction(manager).lessons((query) =>
        query.andWhere('lesson.classId = :classId', { classId }),
      );
    });
  }

  /** A teacher's week in one session, every class they teach in it. */
  teacherTimetable(teacherId: string, sessionId: string | undefined): Promise<LessonDto[]> {
    return this.inSchool(async (manager) => {
      const teacher = await manager.findOne(Teacher, { where: { id: teacherId } });

      if (!teacher) {
        throw new ResourceNotFoundException();
      }

      const session = await this.sessionOrCurrent(manager, sessionId);

      if (session === null) {
        throw new ValidationFailedException([NO_CURRENT_SESSION]);
      }

      return new ReadTimetableAction(manager).lessons((query) =>
        query
          .andWhere('lesson.teacherId = :teacherId', { teacherId })
          .andWhere('lesson.sessionId = :sessionId', { sessionId: session }),
      );
    });
  }

  /**
   * The caller's own week in the current session: what they sit, what their
   * children sit, and what they teach. Empty for someone who does none of those,
   * and empty when the school has no current session, since a pupil cannot
   * choose one.
   */
  myTimetable(): Promise<LessonDto[]> {
    return this.inSchool(async (manager) => {
      const session = await this.sessionOrCurrent(manager, undefined);

      if (session === null) {
        return [];
      }

      return new ReadTimetableAction(manager, myTimetableScope()).lessons((query) =>
        query.andWhere('lesson.sessionId = :sessionId', { sessionId: session }),
      );
    });
  }

  /**
   * Pupils registered for more than one of the electives running in a period.
   *
   * Reported rather than refused: the registration and the lesson are made at
   * different times by different people, and refusing either would block the
   * other's correct work. One query, bounded by the session, that groups each
   * pupil's elective lessons by period and keeps the periods holding more than
   * one. A pupil in three parallel electives is one conflict listing three
   * lessons, not three pairs.
   */
  conflicts(sessionId: string | undefined): Promise<TimetableConflictDto[]> {
    return this.inSchool(async (manager) => {
      const session = await this.sessionOrCurrent(manager, sessionId);

      if (session === null) {
        throw new ValidationFailedException([NO_CURRENT_SESSION]);
      }

      const rows = await manager.query<ConflictRow[]>(CONFLICTS_SQL, [requireTenantId(), session]);

      return rows.map(toConflictDto);
    });
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private inSchool<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.transactions.runInUserAndTenantContext(requireUserId(), requireTenantId(), work);
  }

  /** The named session, which must exist in this school, or the current one, or null. */
  private async sessionOrCurrent(
    manager: EntityManager,
    sessionId: string | undefined,
  ): Promise<string | null> {
    const session = await manager.findOne(AcademicSession, {
      where: sessionId === undefined ? { isCurrent: true } : { id: sessionId },
    });

    if (sessionId !== undefined && !session) {
      throw new ResourceNotFoundException();
    }

    return session?.id ?? null;
  }

  /**
   * A live period, locked. For share when a lesson is being placed in it, for
   * update when it is being removed, so the two cannot interleave.
   */
  private async lockPeriod(
    manager: EntityManager,
    id: string,
    mode: 'pessimistic_read' | 'pessimistic_write',
  ): Promise<TimetablePeriod> {
    const period = await manager
      .createQueryBuilder(TimetablePeriod, 'period')
      .where('period.id = :id', { id })
      .setLock(mode)
      .getOne();

    if (!period) {
      throw new ResourceNotFoundException();
    }

    return period;
  }

  private async refuseLessonClash(
    manager: EntityManager,
    planned: Omit<Parameters<typeof lessonClash>[1], 'tenantId'>,
  ): Promise<void> {
    const clash = await lessonClash(manager, { ...planned, tenantId: requireTenantId() });

    if (clash !== null) {
      throw new ResourceConflictException(clash);
    }
  }

  /**
   * Names the period in the way of a new or changed one: one overlapping it on
   * the same day, or one already using its label that day.
   */
  private async refusePeriodClash(
    manager: EntityManager,
    period: {
      readonly id?: string;
      readonly sessionId: string;
      readonly weekday: number;
      readonly label: string;
      readonly startsAt: string;
      readonly endsAt: string;
    },
  ): Promise<void> {
    const [clash] = await manager.query<
      Array<{ label: string; starts_at: string; ends_at: string; same_label: boolean }>
    >(
      `SELECT label,
              to_char(starts_at, 'HH24:MI') AS starts_at,
              to_char(ends_at, 'HH24:MI') AS ends_at,
              label = $4::citext AS same_label
         FROM timetable_periods
        WHERE tenant_id = $1
          AND session_id = $2
          AND weekday = $3
          AND deleted_at IS NULL
          AND id IS DISTINCT FROM $7::uuid
          AND (label = $4::citext OR (starts_at < $6::time AND ends_at > $5::time))
        ORDER BY label = $4::citext DESC
        LIMIT 1`,
      [
        requireTenantId(),
        period.sessionId,
        period.weekday,
        period.label,
        period.startsAt,
        period.endsAt,
        period.id ?? null,
      ],
    );

    if (clash === undefined) {
      return;
    }

    const day = weekdayName(period.weekday);

    throw new ResourceConflictException(
      clash.same_label
        ? `${day} already has a period called ${clash.label}.`
        : `${day} ${clash.label} (${clash.starts_at} to ${clash.ends_at}) already covers part ` +
            'of that time.',
    );
  }

  private async readLesson(manager: EntityManager, id: string): Promise<LessonDto> {
    const lesson = await new ReadTimetableAction(manager).lesson(id);

    if (!lesson) {
      throw new Error(`Lesson ${id} was written in this transaction and cannot be read back.`);
    }

    return lesson;
  }
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

interface ConflictRow {
  student_id: string;
  student_name: string;
  class_id: string;
  class_name: string;
  period_id: string;
  weekday: number;
  label: string;
  starts_at: string;
  ends_at: string;
  lessons: Array<{
    id: string;
    subjectId: string;
    subjectName: string;
    teacherId: string;
    teacherName: string;
  }>;
}

/**
 * Every elective lesson each pupil sits in the session, through a live
 * registration and a live enrolment in the elective's class, grouped by pupil
 * and period, keeping the periods with more than one.
 */
export const CONFLICTS_SQL = `
  WITH taken AS (
    SELECT registration.student_id,
           lesson.id AS lesson_id,
           lesson.period_id,
           lesson.class_id,
           lesson.class_subject_id,
           lesson.teacher_id
      FROM elective_registrations registration
      JOIN timetable_lessons lesson
        ON lesson.class_subject_id = registration.class_subject_id
       AND lesson.deleted_at IS NULL
      JOIN class_enrolments enrolment
        ON enrolment.student_id = registration.student_id
       AND enrolment.class_id = lesson.class_id
       AND enrolment.deleted_at IS NULL
     WHERE registration.tenant_id = $1
       AND registration.deleted_at IS NULL
       AND lesson.session_id = $2
  ),
  clashing AS (
    SELECT student_id, period_id
      FROM taken
     GROUP BY student_id, period_id
    HAVING count(*) > 1
  )
  SELECT student.id AS student_id,
         student.first_name || ' ' || student.last_name AS student_name,
         klass.id AS class_id,
         grade.name || ' ' || klass.arm AS class_name,
         period.id AS period_id,
         period.weekday,
         period.label,
         to_char(period.starts_at, 'HH24:MI') AS starts_at,
         to_char(period.ends_at, 'HH24:MI') AS ends_at,
         json_agg(json_build_object(
           'id', taken.lesson_id,
           'subjectId', subject.id,
           'subjectName', subject.name,
           'teacherId', teacher.id,
           'teacherName', teacher.first_name || ' ' || teacher.last_name
         ) ORDER BY subject.name) AS lessons
    FROM clashing
    JOIN taken USING (student_id, period_id)
    JOIN students student ON student.id = clashing.student_id
    JOIN timetable_periods period ON period.id = clashing.period_id
    JOIN classes klass ON klass.id = taken.class_id
    JOIN grade_levels grade ON grade.id = klass.grade_level_id
    JOIN class_subjects assignment ON assignment.id = taken.class_subject_id
    JOIN subjects subject ON subject.id = assignment.subject_id
    JOIN teachers teacher ON teacher.id = taken.teacher_id
   GROUP BY student.id, klass.id, grade.id, period.id
   ORDER BY period.weekday, period.starts_at, student_name`;

function toConflictDto(row: ConflictRow): TimetableConflictDto {
  return {
    student: { id: row.student_id, name: row.student_name },
    class: { id: row.class_id, name: row.class_name },
    period: {
      id: row.period_id,
      weekday: row.weekday,
      weekdayName: weekdayName(row.weekday),
      label: row.label,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    },
    lessons: row.lessons.map((lesson) => ({
      id: lesson.id,
      subject: { id: lesson.subjectId, name: lesson.subjectName },
      teacher: { id: lesson.teacherId, name: lesson.teacherName },
    })),
  };
}

function toPeriodDto(row: TimetablePeriod): PeriodDto {
  return {
    id: row.id,
    sessionId: row.sessionId,
    weekday: row.weekday,
    weekdayName: weekdayName(row.weekday),
    label: row.label,
    startsAt: row.startsAt.slice(0, 5),
    endsAt: row.endsAt.slice(0, 5),
  };
}
