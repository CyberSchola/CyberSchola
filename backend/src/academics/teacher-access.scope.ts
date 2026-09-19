import type { Actor, ScopeFragment } from '../common/actions/access-scope';

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

/** Live enrolments only. */
const LIVE_ENROLMENT = 'WHERE tas_enrolment.deleted_at IS NULL';

/**
 * Whether the acting teacher may reach a student.
 *
 * Blueprint sections 13 and 14: a teacher can access a student if they supervise
 * the student's class, or teach a subject that student takes. This is that rule,
 * written once, and it exists in exactly one place so the next module that needs
 * it cannot drift from this one. Attendance, results and lesson notes will each
 * compose it against their own `student_id` column.
 *
 * ## One set of students, computed once
 *
 * A student is reachable through any of three routes:
 *
 * 1. the teacher supervises the student's current class
 * 2. the teacher teaches a core subject in that class, which every enrolled
 *    student takes
 * 3. the teacher teaches an elective in that class that this student registered
 *    for
 *
 * The three are a UNION of student ids, tested with `IN`. The subquery does not
 * refer to the outer row, so Postgres evaluates it once per query and hashes the
 * result, however many rows are being filtered. An earlier version wrote each
 * route as an `EXISTS` correlated with the outer row, which reads naturally and
 * measured at 1.46 seconds for a teacher's first page on a 2,000-student school,
 * because all three subqueries, with their joins, ran again for every student.
 * The set form measures in single-digit milliseconds on the same data.
 *
 * The elective route joins the registration to the student's own enrolment, not
 * just to the subject. A registration pointing at an elective in some other class
 * must not grant anything, and joining through the enrolment is what makes that
 * impossible rather than merely unlikely.
 *
 * Returns a scope fragment: the predicate and the parameter it binds. Row-level
 * security still applies to every table it reads, so it can only ever match
 * within the current school; this narrows further, to the students one teacher
 * is allowed to see. It is the TEACHER branch of the student scope in the people
 * module, which ORs it with the parent and self branches.
 *
 * @param studentIdSql An expression evaluating to the student id to test, such
 *   as `student.id` or `attendance.student_id`.
 */
/**
 * Whether the acting teacher supervises a class, in the current session.
 *
 * A narrower rule than reaching a student, and deliberately so. Blueprint
 * section 95 says a teacher marks attendance for the students they supervise and
 * must not mark another class: taking the school-day register is the form
 * teacher's job, not something every subject teacher may do for every class they
 * teach one lesson in. Reading is the wider rule, marking is this one.
 *
 * When subject attendance arrives, the marker for a `SUBJECT_CLASS` record is
 * the teacher of that subject, which is the second branch of
 * `teacherReachesStudent` rather than this.
 *
 * @param classIdSql An expression evaluating to the class id to test.
 */
export function teacherSupervisesClass(classIdSql: string, actor: Actor): ScopeFragment {
  return {
    sql: `${classIdSql} IN (
      SELECT tas_supervisor.class_id
        FROM class_supervisors tas_supervisor
        JOIN classes tas_class
          ON tas_class.id = tas_supervisor.class_id
         AND tas_class.deleted_at IS NULL
        JOIN academic_sessions tas_session
          ON tas_session.id = tas_class.session_id
         AND tas_session.is_current
         AND tas_session.deleted_at IS NULL
        ${heldByActor('tas_supervisor.teacher_id')}
       WHERE tas_supervisor.deleted_at IS NULL
    )`,
    params: { [ACTOR_PARAM]: actor.userId },
  };
}

export function teacherReachesStudent(studentIdSql: string, actor: Actor): ScopeFragment {
  const enrolment = currentEnrolment();

  const sql = `${studentIdSql} IN (
      SELECT tas_enrolment.student_id ${enrolment}
      JOIN class_supervisors tas_supervisor
        ON tas_supervisor.class_id = tas_class.id
       AND tas_supervisor.deleted_at IS NULL
      ${heldByActor('tas_supervisor.teacher_id')}
      ${LIVE_ENROLMENT}
    UNION
      SELECT tas_enrolment.student_id ${enrolment}
      JOIN class_subjects tas_subject
        ON tas_subject.class_id = tas_class.id
       AND tas_subject.deleted_at IS NULL
       AND NOT tas_subject.is_elective
      ${heldByActor('tas_subject.teacher_id')}
      ${LIVE_ENROLMENT}
    UNION
      SELECT tas_enrolment.student_id ${enrolment}
      JOIN class_subjects tas_subject
        ON tas_subject.class_id = tas_class.id
       AND tas_subject.deleted_at IS NULL
       AND tas_subject.is_elective
      JOIN elective_registrations tas_registration
        ON tas_registration.class_subject_id = tas_subject.id
       AND tas_registration.student_id = tas_enrolment.student_id
       AND tas_registration.deleted_at IS NULL
      ${heldByActor('tas_subject.teacher_id')}
      ${LIVE_ENROLMENT}
  )`;

  return { sql, params: { [ACTOR_PARAM]: actor.userId } };
}
