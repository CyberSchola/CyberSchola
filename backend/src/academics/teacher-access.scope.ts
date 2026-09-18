import type { ObjectLiteral } from 'typeorm';

import { Role } from '../auth/permission.matrix';
import { type AccessScope, scopeFor } from '../common/actions/access-scope';
import type { Student } from './entities/student.entity';

/** Bound once per query. The name is namespaced so it cannot collide with a caller's. */
const ACTOR_PARAM = '__teacherScopeActorUserId';

/**
 * The student's live enrolment, in a class belonging to the current session.
 *
 * The current-session restriction is deliberate and easy to lose. Classes belong
 * to a session, so without it a teacher who supervised JSS2A last year would
 * keep reaching every student who was in it, forever, and every teacher would
 * accumulate access to every student they ever taught. Access follows this
 * year's assignments, which is what blueprint section 14 means by deriving it
 * from assignments.
 *
 * Inner aliases are prefixed so they can never shadow an alias in the query this
 * fragment is composed into.
 */
function currentEnrolment(): string {
  return `
    FROM class_enrolments tas_enrolment
    JOIN classes tas_class
      ON tas_class.id = tas_enrolment.class_id
     AND tas_class.deleted_at IS NULL
    JOIN academic_sessions tas_session
      ON tas_session.id = tas_class.session_id
     AND tas_session.is_current
     AND tas_session.deleted_at IS NULL`;
}

/**
 * Narrows to assignments held by the acting person, through a live, active
 * membership.
 *
 * `status = 'ACTIVE'` is checked here even though a suspended membership cannot
 * resolve a tenant in the first place. It costs one predicate and means this
 * rule does not depend on the request path having already filtered suspended
 * people out, which matters once background jobs call it.
 */
function heldByActor(teacherIdSql: string): string {
  return `
    JOIN teachers tas_teacher
      ON tas_teacher.id = ${teacherIdSql}
     AND tas_teacher.deleted_at IS NULL
    JOIN memberships tas_membership
      ON tas_membership.id = tas_teacher.membership_id
     AND tas_membership.deleted_at IS NULL
     AND tas_membership.status = 'ACTIVE'
     AND tas_membership.user_id = :${ACTOR_PARAM}`;
}

function forStudent(studentIdSql: string): string {
  return `
    WHERE tas_enrolment.student_id = ${studentIdSql}
      AND tas_enrolment.deleted_at IS NULL`;
}

/**
 * Whether the acting teacher may reach a student.
 *
 * Blueprint sections 13 and 14: a teacher can access a student if they supervise
 * the student's class, or teach a subject that student takes. This is that rule,
 * written once, and it exists in exactly one place so the next module that needs
 * it cannot drift from this one. Attendance, results and lesson notes will each
 * compose it against their own `student_id` column.
 *
 * ## Three EXISTS, joined by OR at the top
 *
 * One per way a teacher can reach a student:
 *
 * 1. supervises the student's current class
 * 2. teaches a core subject in that class, which every enrolled student takes
 * 3. teaches an elective in that class that this student registered for
 *
 * Kept as three separate subqueries rather than one EXISTS over a UNION, so each
 * is small enough to use its own index and Postgres stops at the first branch
 * that matches. A UNION would build the whole set before testing it.
 *
 * The elective branch checks the registration against the subject **and** the
 * student's own class. A registration pointing at an elective in some other
 * class must not grant anything, and joining through the enrolment is what makes
 * that impossible rather than merely unlikely.
 *
 * Returns a SQL predicate. Row-level security still applies to every table it
 * reads, so it can only ever match within the current school; this narrows
 * further, to the students one teacher is allowed to see.
 *
 * @param studentIdSql An expression evaluating to the student id to test, such
 *   as `student.id` or `attendance.student_id`.
 */
export function teacherCanReachStudent(studentIdSql: string): string {
  const enrolment = currentEnrolment();
  const student = forStudent(studentIdSql);

  return `(
    EXISTS (
      SELECT 1 ${enrolment}
      JOIN class_supervisors tas_supervisor
        ON tas_supervisor.class_id = tas_class.id
       AND tas_supervisor.deleted_at IS NULL
      ${heldByActor('tas_supervisor.teacher_id')}
      ${student}
    )
    OR EXISTS (
      SELECT 1 ${enrolment}
      JOIN class_subjects tas_subject
        ON tas_subject.class_id = tas_class.id
       AND tas_subject.deleted_at IS NULL
       AND NOT tas_subject.is_elective
      ${heldByActor('tas_subject.teacher_id')}
      ${student}
    )
    OR EXISTS (
      SELECT 1 ${enrolment}
      JOIN class_subjects tas_subject
        ON tas_subject.class_id = tas_class.id
       AND tas_subject.deleted_at IS NULL
       AND tas_subject.is_elective
      JOIN elective_registrations tas_registration
        ON tas_registration.class_subject_id = tas_subject.id
       AND tas_registration.student_id = ${studentIdSql}
       AND tas_registration.deleted_at IS NULL
      ${heldByActor('tas_subject.teacher_id')}
      ${student}
    )
  )`;
}

/**
 * The teacher rule as an access scope, for any entity with a student id.
 *
 * A school administrator sees every student in the school. Everyone else is
 * narrowed by the rule above, which fails closed for anyone who is not a
 * teacher: a student or parent who somehow reached a student list would match
 * no branch, because they hold no supervision or subject assignment.
 *
 * @param studentIdColumn The entity property holding the student id, such as
 *   `id` for Student or `studentId` for a future Attendance. TypeORM resolves
 *   `alias.property` to the real column, so this is the property name rather
 *   than the database column name.
 */
export function teacherAccessScope<TEntity extends ObjectLiteral>(
  studentIdColumn: string,
): AccessScope<TEntity> {
  return scopeFor<TEntity>({
    unrestrictedRoles: [Role.SchoolAdmin],
    narrow: (query, alias, actor) =>
      void query.andWhere(teacherCanReachStudent(`${alias}.${studentIdColumn}`), {
        [ACTOR_PARAM]: actor.userId,
      }),
  });
}

/** The scope for the students table itself. */
export const studentAccessScope = (): AccessScope<Student> => teacherAccessScope<Student>('id');
