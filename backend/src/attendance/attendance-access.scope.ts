import type { ObjectLiteral } from 'typeorm';

import { teacherReachesStudent } from '../academics/teacher-access.scope';
import { Role } from '../auth/permission.matrix';
import {
  type AccessScope,
  type Actor,
  combineFragments,
  type ScopeFragment,
  scopeFor,
} from '../common/actions/access-scope';
import { staffIsSelf, teacherIsSelf } from '../people/employee-access.scope';
import { parentOfStudent, studentIsSelf } from '../people/student-access.scope';

/**
 * Which attendance records a caller may read.
 *
 * Blueprint section 95, as a predicate. Note what is *not* here: whether a
 * caller may mark attendance at all, and whether they may mark this particular
 * class, are separate questions answered by the route permission and by
 * `AttendanceService` respectively. This one narrows reads.
 *
 * - SCHOOL_ADMIN reads everything in the school.
 * - TEACHER reads the students section 14 allows, plus their own record.
 * - PARENT reads their linked children.
 * - STUDENT reads themselves.
 * - STAFF reads themselves.
 *
 * A person holding several roles reads the union, which is the point of the OR:
 * a teacher whose child attends the school sees their pupils, their own days,
 * and their child's, in one query.
 *
 * ## Why the branches cannot leak into each other
 *
 * Every branch tests a column that is NULL on the kinds of row it is not about.
 * A teacher's own record has `student_id` NULL, so the student branches evaluate
 * `NULL IN (...)`, which is NULL and therefore not true, and the row is not
 * returned by them. That is not a coincidence to be relied on quietly: the check
 * constraint in migration 1757800000000 is what guarantees the irrelevant
 * columns are NULL, and `attendance-visibility.integration-spec` asserts each
 * role sees exactly the rows it should across all three kinds.
 */
export function attendanceScope<TEntity extends ObjectLiteral>(): AccessScope<TEntity> {
  const student = (alias: string) => `${alias}.studentId`;
  const teacher = (alias: string) => `${alias}.teacherId`;
  const staff = (alias: string) => `${alias}.staffId`;

  return scopeFor<TEntity>({
    unrestrictedRoles: [Role.SchoolAdmin],
    byRole: {
      [Role.Teacher]: (alias, actor) =>
        anyOf([teacherReachesStudent(student(alias), actor), teacherIsSelf(teacher(alias), actor)]),
      [Role.Parent]: (alias, actor) => parentOfStudent(student(alias), actor),
      [Role.Student]: (alias, actor) => studentIsSelf(student(alias), actor),
      [Role.Staff]: (alias, actor) => staffIsSelf(staff(alias), actor),
    },
  });
}

/**
 * One role, two reasons.
 *
 * A teacher reaches a row either because it is about a student they teach or
 * because it is about them. `combineFragments` already ORs and de-duplicates
 * fragments and refuses colliding parameters, so the rule for one role composes
 * the same way the rules for several roles do.
 */
function anyOf(fragments: readonly ScopeFragment[]): ScopeFragment {
  return combineFragments(fragments);
}

/**
 * Which students a teacher may mark, as a set of ids.
 *
 * Re-exported through this module so the marking path and the reading path
 * cannot drift apart: section 95 says a teacher marks the students they are
 * authorized to supervise and must not mark another class, and that is the same
 * rule as reaching them.
 */
export function teacherMayMarkStudent(studentIdSql: string, actor: Actor): ScopeFragment {
  return teacherReachesStudent(studentIdSql, actor);
}
