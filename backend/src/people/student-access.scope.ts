import type { ObjectLiteral } from 'typeorm';

import { teacherReachesStudent } from '../academics/teacher-access.scope';
import { Role } from '../auth/permission.matrix';
import {
  type AccessScope,
  type Actor,
  type ScopeFragment,
  scopeFor,
} from '../common/actions/access-scope';

const PARENT_PARAM = '__parentScopeActorUserId';
const SELF_PARAM = '__selfScopeActorUserId';

/**
 * Whether the acting person is a linked parent of a student.
 *
 * Blueprint section 17 and rule 10: a parent may only access children linked to
 * their account. The link is a live guardianship, from a live parent record,
 * through an active membership held by the caller. Every one of those conditions
 * is in the predicate, so removing any of them (unlinking the child, removing the
 * parent record, suspending the membership) removes access on the next request.
 *
 * Written as a set of student ids tested with `IN`, not a correlated `EXISTS`,
 * so the subquery runs once per query rather than once per row: see the note on
 * `teacherReachesStudent`. Inner aliases are prefixed `sas_` so they cannot
 * shadow the outer query.
 */
export function parentOfStudent(studentIdSql: string, actor: Actor): ScopeFragment {
  return {
    sql: `${studentIdSql} IN (
      SELECT sas_guardianship.student_id
        FROM guardianships sas_guardianship
        JOIN parents sas_parent
          ON sas_parent.id = sas_guardianship.parent_id
         AND sas_parent.deleted_at IS NULL
        JOIN memberships sas_parent_membership
          ON sas_parent_membership.id = sas_parent.membership_id
         AND sas_parent_membership.deleted_at IS NULL
         AND sas_parent_membership.status = 'ACTIVE'
         AND sas_parent_membership.user_id = :${PARENT_PARAM}
       WHERE sas_guardianship.deleted_at IS NULL
    )`,
    params: { [PARENT_PARAM]: actor.userId },
  };
}

/**
 * Whether the student is the acting person.
 *
 * Blueprint section 16 and rule 11: a student may only access their own data.
 * Tested through the student record's linked membership, so a student record
 * with no login is nobody's self.
 */
export function studentIsSelf(studentIdSql: string, actor: Actor): ScopeFragment {
  return {
    sql: `${studentIdSql} IN (
      SELECT sas_self.id
        FROM students sas_self
        JOIN memberships sas_self_membership
          ON sas_self_membership.id = sas_self.membership_id
         AND sas_self_membership.deleted_at IS NULL
         AND sas_self_membership.status = 'ACTIVE'
         AND sas_self_membership.user_id = :${SELF_PARAM}
       WHERE sas_self.deleted_at IS NULL
    )`,
    params: { [SELF_PARAM]: actor.userId },
  };
}

/**
 * Which students a caller may reach, for any entity carrying a student id.
 *
 * - SCHOOL_ADMIN: every student in the school.
 * - TEACHER: the students blueprint sections 13 and 14 allow, through current
 *   supervision, core subjects and registered electives.
 * - PARENT: their linked children.
 * - STUDENT: themselves.
 * - STAFF: nobody (section 18 keeps staff to their own information).
 *
 * A person holding several roles reaches the union. Attendance, results and
 * lesson notes compose this same scope against their own `student_id` column,
 * so the rule exists once.
 *
 * @param studentIdColumn The entity property holding the student id: `id` for
 *   Student, `studentId` for a future Attendance.
 */
export function studentScope<TEntity extends ObjectLiteral>(
  studentIdColumn: string,
): AccessScope<TEntity> {
  const column = (alias: string) => `${alias}.${studentIdColumn}`;

  return scopeFor<TEntity>({
    unrestrictedRoles: [Role.SchoolAdmin],
    byRole: {
      [Role.Teacher]: (alias, actor) => teacherReachesStudent(column(alias), actor),
      [Role.Parent]: (alias, actor) => parentOfStudent(column(alias), actor),
      [Role.Student]: (alias, actor) => studentIsSelf(column(alias), actor),
    },
  });
}
