import { Role } from '../auth/permission.matrix';
import {
  type AccessScope,
  type Actor,
  type ScopeFragment,
  scopeFor,
} from '../common/actions/access-scope';
import { teacherIsSelf } from '../people/employee-access.scope';
import { parentOfStudent, studentIsSelf } from '../people/student-access.scope';
import type { TimetableLesson } from './entities/timetable-lesson.entity';

/**
 * The lessons a set of pupils sits in.
 *
 * A pupil sits every core lesson of the class they are enrolled in, and the
 * electives they registered for, in that same class. The second half joins the
 * registration to a live enrolment in the elective's class, as the teacher rule
 * does, so a registration left behind by a pupil who changed class shows them
 * nothing from the class they left.
 *
 * Both halves are uncorrelated `IN` sets, evaluated once per query, for the
 * reason recorded on `teacherReachesStudent`. `whose` supplies the pupils: the
 * caller themselves, or the caller's children. It is called once per half, and
 * both calls bind the same parameter to the same value, so they merge.
 */
function lessonsSatBy(
  alias: string,
  whose: (studentIdSql: string) => ScopeFragment,
): ScopeFragment {
  const enrolled = whose('mts_enrolment.student_id');
  const registered = whose('mts_registration.student_id');

  return {
    sql: `(
      (NOT ${alias}.isElective AND ${alias}.classId IN (
        SELECT mts_enrolment.class_id
          FROM class_enrolments mts_enrolment
         WHERE mts_enrolment.deleted_at IS NULL
           AND ${enrolled.sql}
      ))
      OR
      (${alias}.isElective AND ${alias}.classSubjectId IN (
        SELECT mts_registration.class_subject_id
          FROM elective_registrations mts_registration
          JOIN class_subjects mts_subject
            ON mts_subject.id = mts_registration.class_subject_id
          JOIN class_enrolments mts_enrolment
            ON mts_enrolment.class_id = mts_subject.class_id
           AND mts_enrolment.student_id = mts_registration.student_id
           AND mts_enrolment.deleted_at IS NULL
         WHERE mts_registration.deleted_at IS NULL
           AND ${registered.sql}
      ))
    )`,
    params: { ...enrolled.params, ...registered.params },
  };
}

/**
 * Whose timetable `GET /me/timetable` is: the caller's own, and nobody else's.
 *
 * - STUDENT: the lessons they sit.
 * - PARENT: the lessons each linked child sits.
 * - TEACHER: the lessons they teach.
 * - SCHOOL_ADMIN and STAFF: nothing of their own. An administrator reads any
 *   class or teacher timetable through those routes, but "mine" is not "the
 *   school's", so no role is unrestricted here.
 *
 * A person with several roles gets the union: a teacher whose child is a pupil
 * sees what they teach and what their child sits, in one week.
 *
 * Every other timetable read is open to every member, blueprint section 22, so
 * this is the only scope the module has.
 */
export function myTimetableScope(): AccessScope<TimetableLesson> {
  return scopeFor<TimetableLesson>({
    unrestrictedRoles: [],
    byRole: {
      [Role.Student]: (alias, actor: Actor) =>
        lessonsSatBy(alias, (studentIdSql) => studentIsSelf(studentIdSql, actor)),
      [Role.Parent]: (alias, actor: Actor) =>
        lessonsSatBy(alias, (studentIdSql) => parentOfStudent(studentIdSql, actor)),
      [Role.Teacher]: (alias, actor: Actor) => teacherIsSelf(`${alias}.teacherId`, actor),
    },
  });
}
