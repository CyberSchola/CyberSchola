import type { Actor, ScopeFragment } from '../common/actions/access-scope';

const TEACHER_PARAM = '__teacherSelfScopeActorUserId';
const STAFF_PARAM = '__staffSelfScopeActorUserId';

/**
 * Whether an employee record is the acting person's own.
 *
 * The twin of `studentIsSelf` for the two role tables that describe people the
 * school employs. Blueprint section 18 keeps staff to their own information, and
 * a teacher's own attendance is theirs on the same reasoning.
 *
 * The same shape as every other fragment here: a set tested with `IN` rather
 * than a correlated `EXISTS`, so it is evaluated once per query however many
 * rows are being filtered, and inner aliases are prefixed so they cannot shadow
 * the query this composes into. The record is reached through a live, active
 * membership, so suspending someone removes their access on the next request.
 *
 * A record with no linked login is nobody's self, which is why the membership
 * join is inner rather than left: teachers and staff created before they have an
 * account exist, and nobody is them.
 */
function employeeIsSelf(options: {
  readonly idSql: string;
  readonly table: string;
  readonly prefix: string;
  readonly param: string;
  readonly actor: Actor;
}): ScopeFragment {
  const { idSql, table, prefix, param, actor } = options;

  return {
    sql: `${idSql} IN (
      SELECT ${prefix}_self.id
        FROM ${table} ${prefix}_self
        JOIN memberships ${prefix}_self_membership
          ON ${prefix}_self_membership.id = ${prefix}_self.membership_id
         AND ${prefix}_self_membership.deleted_at IS NULL
         AND ${prefix}_self_membership.status = 'ACTIVE'
         AND ${prefix}_self_membership.user_id = :${param}
       WHERE ${prefix}_self.deleted_at IS NULL
    )`,
    params: { [param]: actor.userId },
  };
}

/** Whether a teacher record belongs to the acting person. */
export function teacherIsSelf(teacherIdSql: string, actor: Actor): ScopeFragment {
  return employeeIsSelf({
    idSql: teacherIdSql,
    table: 'teachers',
    prefix: 'eas_teacher',
    param: TEACHER_PARAM,
    actor,
  });
}

/** Whether a staff record belongs to the acting person. */
export function staffIsSelf(staffIdSql: string, actor: Actor): ScopeFragment {
  return employeeIsSelf({
    idSql: staffIdSql,
    table: 'staff',
    prefix: 'eas_staff',
    param: STAFF_PARAM,
    actor,
  });
}
