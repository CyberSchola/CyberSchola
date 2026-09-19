import type { EntityManager, SelectQueryBuilder } from 'typeorm';

import { type AccessScope, unrestrictedScope } from '../common/actions/access-scope';
import { TenantScopedAction } from '../common/actions/tenant-scoped.action';
import { TimetableLesson } from './entities/timetable-lesson.entity';
import type { LessonDto, LessonPeriodDto } from './timetable.dto';
import { weekdayName } from './weekdays';

/** One lesson with everything a reader shows, as the query returns it. */
interface LessonRow {
  id: string;
  period_id: string;
  weekday: number;
  label: string;
  starts_at: string;
  ends_at: string;
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  teacher_id: string;
  teacher_name: string;
  class_subject_id: string;
  is_elective: boolean;
}

/**
 * Reads lessons as a flat week: every lesson with its period, class, subject and
 * teacher, ordered by weekday and start time.
 *
 * One query shape for every timetable read, so a class's week, a teacher's week
 * and a caller's own week cannot drift apart in what they show or how they sort.
 * What differs is the filter each caller adds and the scope the action is built
 * with: none for the class and teacher views, which every member may read, and
 * `myTimetableScope` for the caller's own.
 *
 * The joins are by table name, not entity, on purpose. TypeORM adds a soft-delete
 * predicate to every entity it joins, and a lesson whose teacher record has since
 * been removed is still a lesson in the week: hiding it would show a free period
 * that is not free. Lessons themselves are filtered to live ones explicitly.
 */
export class ReadTimetableAction extends TenantScopedAction<TimetableLesson> {
  constructor(
    manager: EntityManager,
    protected readonly accessScope: AccessScope<TimetableLesson> = unrestrictedScope(),
  ) {
    super(manager, TimetableLesson);
  }

  /** The lessons that pass `filter`, in week order. */
  async lessons(
    filter: (query: SelectQueryBuilder<TimetableLesson>) => void,
  ): Promise<LessonDto[]> {
    const rows = await this.lessonsQuery(filter).getRawMany<LessonRow>();

    return rows.map(toLessonDto);
  }

  /**
   * The statement `lessons` runs. Public so the performance suite can EXPLAIN the
   * exact query a request would, rather than a copy of it that could drift.
   *
   * @param filter Narrows `lesson` further, such as to one class. Receives the
   *   query with the tenant predicate and this action's scope already applied.
   */
  lessonsQuery(
    filter: (query: SelectQueryBuilder<TimetableLesson>) => void,
  ): SelectQueryBuilder<TimetableLesson> {
    const query = this.scopedQuery('lesson')
      // The session equalities are true by the foreign keys already. Stating them
      // lets Postgres carry a session filter on the lesson across to the class and
      // period, so a read starting from classes starts from this year's forty
      // rather than every class the school has ever had. Without them, a caller's
      // own week measured at every lesson of every year examined.
      .innerJoin(
        'timetable_periods',
        'period',
        'period.id = lesson.periodId AND period.session_id = lesson.sessionId',
      )
      .innerJoin(
        'classes',
        'klass',
        'klass.id = lesson.classId AND klass.session_id = lesson.sessionId',
      )
      .innerJoin('grade_levels', 'grade', 'grade.id = klass.grade_level_id')
      .innerJoin('class_subjects', 'assignment', 'assignment.id = lesson.classSubjectId')
      .innerJoin('subjects', 'subject', 'subject.id = assignment.subject_id')
      .innerJoin('teachers', 'teacher', 'teacher.id = lesson.teacherId')
      .select('lesson.id', 'id')
      .addSelect('period.id', 'period_id')
      .addSelect('period.weekday', 'weekday')
      .addSelect('period.label', 'label')
      .addSelect(`to_char(period.starts_at, 'HH24:MI')`, 'starts_at')
      .addSelect(`to_char(period.ends_at, 'HH24:MI')`, 'ends_at')
      .addSelect('klass.id', 'class_id')
      .addSelect(`grade.name || ' ' || klass.arm`, 'class_name')
      .addSelect('subject.id', 'subject_id')
      .addSelect('subject.name', 'subject_name')
      .addSelect('teacher.id', 'teacher_id')
      .addSelect(`teacher.first_name || ' ' || teacher.last_name`, 'teacher_name')
      .addSelect('lesson.classSubjectId', 'class_subject_id')
      .addSelect('lesson.isElective', 'is_elective')
      .andWhere('lesson.deletedAt IS NULL')
      .orderBy('period.weekday', 'ASC')
      .addOrderBy('period.starts_at', 'ASC')
      .addOrderBy('class_name', 'ASC')
      .addOrderBy('subject_name', 'ASC');

    filter(query);

    return query;
  }

  /** One live lesson by id, in the same shape, or null. */
  async lesson(id: string): Promise<LessonDto | null> {
    const [found] = await this.lessons((query) =>
      query.andWhere('lesson.id = :lessonId', { lessonId: id }),
    );

    return found ?? null;
  }
}

function toLessonDto(row: LessonRow): LessonDto {
  return {
    id: row.id,
    period: toLessonPeriod(row),
    class: { id: row.class_id, name: row.class_name },
    subject: { id: row.subject_id, name: row.subject_name },
    teacher: { id: row.teacher_id, name: row.teacher_name },
    classSubjectId: row.class_subject_id,
    isElective: row.is_elective,
  };
}

function toLessonPeriod(row: LessonRow): LessonPeriodDto {
  return {
    id: row.period_id,
    weekday: row.weekday,
    weekdayName: weekdayName(row.weekday),
    label: row.label,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}
