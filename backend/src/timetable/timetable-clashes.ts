import type { EntityManager } from 'typeorm';

import { weekdayName } from './weekdays';

/**
 * Finding a timetable clash before the database refuses it, to say what it is.
 *
 * The database is the rule. Every clash these look for is also a constraint on
 * `timetable_lessons`, and two administrators racing past these checks still
 * meet it, as a plain 409. What these add is the sentence: "Adaeze Okonkwo
 * already teaches JSS 3 B in Tuesday P3" says what to move, where a constraint
 * name says only that something is wrong.
 *
 * Plain functions over a manager rather than a provider, because two modules
 * need them: the timetable, when a lesson is placed or moved, and the academic
 * assignments, when a class subject changes teacher and its lessons follow.
 */

/** The names a clash message needs, for one lesson already in the way. */
interface ClashRow {
  teacher_clash: boolean;
  is_elective: boolean;
  teacher_name: string;
  class_name: string;
  subject_name: string;
  weekday: number;
  label: string;
}

/** Joins every name a message uses onto `lesson`. Shared by both queries. */
const NAMES = `
  JOIN timetable_periods period ON period.id = lesson.period_id
  JOIN classes klass ON klass.id = lesson.class_id
  JOIN grade_levels grade ON grade.id = klass.grade_level_id
  JOIN class_subjects assignment ON assignment.id = lesson.class_subject_id
  JOIN subjects subject ON subject.id = assignment.subject_id
  JOIN teachers teacher ON teacher.id = lesson.teacher_id`;

const NAME_COLUMNS = `
  lesson.is_elective,
  teacher.first_name || ' ' || teacher.last_name AS teacher_name,
  grade.name || ' ' || klass.arm AS class_name,
  subject.name AS subject_name,
  period.weekday,
  period.label`;

/** A lesson about to be placed in a period, or moved into one. */
export interface PlannedLesson {
  readonly tenantId: string;
  readonly periodId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly isElective: boolean;
  /** The lesson being moved, which cannot clash with itself. */
  readonly movingLessonId?: string;
}

/**
 * Why a lesson cannot go in its period, or null when nothing is in the way.
 *
 * Looks for the three things the constraints refuse: the teacher already
 * teaching then, a core lesson where the class already has one, and a core
 * lesson beside electives or an elective beside a core lesson. The teacher's
 * clash is reported first when there are several, since moving the teacher's
 * other lesson is usually the fix. Ties go to the first subject by name, so the
 * same request always names the same clash.
 */
export async function lessonClash(
  manager: EntityManager,
  planned: PlannedLesson,
): Promise<string | null> {
  const [clash] = await manager.query<ClashRow[]>(
    `SELECT lesson.teacher_id = $3 AS teacher_clash, ${NAME_COLUMNS}
       FROM timetable_lessons lesson
       ${NAMES}
      WHERE lesson.tenant_id = $1
        AND lesson.period_id = $2
        AND lesson.deleted_at IS NULL
        AND lesson.id IS DISTINCT FROM $6::uuid
        AND (lesson.teacher_id = $3
             OR (lesson.class_id = $4 AND (NOT $5::boolean OR NOT lesson.is_elective)))
      ORDER BY lesson.teacher_id = $3 DESC, subject.name
      LIMIT 1`,
    [
      planned.tenantId,
      planned.periodId,
      planned.teacherId,
      planned.classId,
      planned.isElective,
      planned.movingLessonId ?? null,
    ],
  );

  return clash === undefined ? null : describeLessonClash(clash, planned.isElective);
}

function describeLessonClash(clash: ClashRow, plannedIsElective: boolean): string {
  const when = `${weekdayName(clash.weekday)} ${clash.label}`;

  if (clash.teacher_clash) {
    return `${clash.teacher_name} already teaches ${clash.class_name} in ${when}.`;
  }

  if (!clash.is_elective && !plannedIsElective) {
    return `${clash.class_name} already has ${clash.subject_name} in ${when}.`;
  }

  if (!clash.is_elective) {
    return (
      `${clash.class_name} already has ${clash.subject_name} in ${when}, ` +
      'and an elective cannot share a period with a core lesson.'
    );
  }

  return (
    `${clash.class_name} already has ${clash.subject_name}, an elective, in ${when}, ` +
    'and a core lesson cannot share a period with electives.'
  );
}

/**
 * Why a class subject cannot be handed to a teacher, or null when it can.
 *
 * Its lessons follow it to the new teacher, so the question is whether that
 * teacher already teaches something else in any period this subject occupies.
 */
export async function reassignmentClash(
  manager: EntityManager,
  tenantId: string,
  classSubjectId: string,
  teacherId: string,
): Promise<string | null> {
  const [clash] = await manager.query<
    Array<ClashRow & { moving_class: string; moving_subject: string }>
  >(
    `SELECT ${NAME_COLUMNS},
            moving_grade.name || ' ' || moving_class.arm AS moving_class,
            moving_subject.name AS moving_subject
       FROM timetable_lessons moving
       JOIN timetable_lessons lesson
         ON lesson.period_id = moving.period_id
        AND lesson.teacher_id = $3
        AND lesson.class_subject_id <> moving.class_subject_id
        AND lesson.deleted_at IS NULL
       ${NAMES}
       JOIN classes moving_class ON moving_class.id = moving.class_id
       JOIN grade_levels moving_grade ON moving_grade.id = moving_class.grade_level_id
       JOIN class_subjects moving_assignment ON moving_assignment.id = moving.class_subject_id
       JOIN subjects moving_subject ON moving_subject.id = moving_assignment.subject_id
      WHERE moving.tenant_id = $1
        AND moving.class_subject_id = $2
        AND moving.deleted_at IS NULL
      ORDER BY period.weekday, period.starts_at
      LIMIT 1`,
    [tenantId, classSubjectId, teacherId],
  );

  if (clash === undefined) {
    return null;
  }

  return (
    `${clash.teacher_name} already teaches ${clash.class_name} in ` +
    `${weekdayName(clash.weekday)} ${clash.label}, when ${clash.moving_class} ` +
    `${clash.moving_subject} is timetabled.`
  );
}
