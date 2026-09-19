/**
 * Roles a person can hold in a school.
 *
 * A person may hold several at once: a teacher whose child attends the same
 * school is a teacher and a parent on one membership. Each role is a row in its
 * own table (see `ROLE_TABLES` in the people module), and `membership_roles`
 * reads them back.
 *
 * Mirrors the `memberships_role_enum` type in migration 1757500000000. The two
 * are kept in step by a test that reads the database enum and compares, rather
 * than by anyone remembering, because a value added on one side and not the
 * other is a role the application silently grants nothing to.
 *
 * There is deliberately no SUPER_ADMIN. A platform administrator is not a
 * member of a school, and modelling them as one would mean a membership row in
 * every tenant. That boundary is recorded in the backend README.
 */
export enum Role {
  SchoolAdmin = 'SCHOOL_ADMIN',
  Teacher = 'TEACHER',
  Student = 'STUDENT',
  Parent = 'PARENT',
  Staff = 'STAFF',
}

/**
 * What a caller is allowed to do, named as an action on a resource.
 *
 * Routes declare a permission rather than a list of roles. The difference
 * matters when a role changes: naming roles at the route scatters the same
 * tuple across every handler, so adding a role means finding all of them, and
 * the ones missed fail by denying, quietly. Naming a permission means the
 * change is one edit to the map below, where a reviewer can see it whole.
 *
 * A string enum, like `ErrorCode` and `AuditCode`, so a typo is a compile error
 * and the value is still readable in a log line.
 */
export enum Permission {
  /** See who belongs to a school. Which rows is a separate question, answered
   *  by the access scope rather than by this. */
  MembershipRead = 'membership.read',
  /** Add, change or remove a membership. Enrolment. */
  MembershipWrite = 'membership.write',
  /** See the school's own record. */
  SchoolRead = 'school.read',
  /** Change the school's own record. */
  SchoolUpdate = 'school.update',
  /** See the academic structure: sessions, terms, grade levels, classes, subjects. */
  AcademicRead = 'academic.read',
  /**
   * Shape the academic structure and who is placed in it: create sessions,
   * terms, classes and subjects, and assign teachers and enrol students.
   * Blueprint section 12 puts all of this under the administrator.
   */
  AcademicManage = 'academic.manage',
  /**
   * See students. Which ones is the access scope's question: an administrator
   * sees the whole school, a teacher sees only the students blueprint sections
   * 13 and 14 allow, a parent sees their own children (section 17), and a
   * student sees themselves (section 16).
   */
  StudentRead = 'student.read',
  /**
   * Create, update and remove the people of a school, link a login to a person's
   * record, and manage which parents are linked to which children. Blueprint
   * section 12 puts people management under the administrator.
   */
  PeopleManage = 'people.manage',
  /**
   * See attendance. Whose is the access scope's question: blueprint section 95
   * gives an administrator the school, a teacher the students they supervise
   * plus their own record, a parent their linked children, and a student and a
   * staff member themselves.
   */
  AttendanceRead = 'attendance.read',
  /**
   * Record attendance. Section 95 again, and again the endpoint is not the whole
   * rule: a teacher holding this may still only mark a class they supervise, and
   * a staff member may only mark themselves. Those are checked per request.
   */
  AttendanceMark = 'attendance.mark',
  /**
   * Change a recorded status, which section 95 gives to the administrator alone
   * along with approving corrections. A teacher who takes the wrong register
   * asks an administrator, and section 96's trail records who actually changed
   * it and why.
   */
  AttendanceCorrect = 'attendance.correct',
  /**
   * See assessment results. Whose is the student scope's question: the school
   * for an administrator, the pupils a teacher teaches, a parent's children, a
   * pupil's own.
   */
  ResultRead = 'result.read',
  /**
   * Enter and correct assessment scores. Like marking attendance, the endpoint
   * is not the whole rule: a teacher holding this may only enter scores for a
   * class subject they teach in the current session. That is checked per
   * request.
   */
  ResultEnter = 'result.enter',
}

/**
 * The security policy of the application, in one place.
 *
 * Everything else in this area is plumbing around this table. It lives in code
 * rather than in the database on purpose: changing what a role may do **is** a
 * security change, so it should arrive as a pull request that a person reviews,
 * that CI runs, and that shows up in a diff as a line somebody had to agree
 * with. A row in a table can be edited by anyone with access to the table, at
 * three in the morning, with no reviewer and no record.
 *
 * Making it editable per school is a genuine product requirement one day. It
 * needs an audit trail, an editing interface and a cache invalidation story
 * before it is safe, which makes it a feature rather than a foundation. Moving
 * to that later is additive: routes already name permissions, not roles.
 *
 * Note what every role shares. `MembershipRead` is held by everyone, because
 * the question "may you use this endpoint" is not the question "which rows may
 * you see". A teacher may list members; the access scope narrows that list to
 * themselves. Conflating the two would mean either denying teachers the
 * endpoint entirely or handing them the whole school.
 */
const MATRIX: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  [Role.SchoolAdmin]: [
    Permission.MembershipRead,
    Permission.MembershipWrite,
    Permission.SchoolRead,
    Permission.SchoolUpdate,
    Permission.AcademicRead,
    Permission.AcademicManage,
    Permission.StudentRead,
    Permission.PeopleManage,
    Permission.AttendanceRead,
    Permission.ResultRead,
    Permission.AttendanceMark,
    Permission.AttendanceCorrect,
    Permission.ResultEnter,
  ],
  [Role.Teacher]: [
    Permission.MembershipRead,
    Permission.SchoolRead,
    Permission.AcademicRead,
    Permission.StudentRead,
    Permission.AttendanceRead,
    Permission.ResultRead,
    Permission.AttendanceMark,
    Permission.ResultEnter,
  ],
  [Role.Student]: [
    Permission.MembershipRead,
    Permission.SchoolRead,
    Permission.AcademicRead,
    Permission.StudentRead,
    Permission.AttendanceRead,
    Permission.ResultRead,
  ],
  [Role.Parent]: [
    Permission.MembershipRead,
    Permission.SchoolRead,
    Permission.AcademicRead,
    Permission.StudentRead,
    Permission.AttendanceRead,
    Permission.ResultRead,
  ],
  // Staff mark their own attendance where self check-in is enabled, and see
  // their own. Section 18 and section 95.
  [Role.Staff]: [
    Permission.MembershipRead,
    Permission.SchoolRead,
    Permission.AcademicRead,
    Permission.AttendanceRead,
    Permission.AttendanceMark,
  ],
});

/** Lookup sets, built once. The matrix above stays the readable declaration. */
const PERMISSIONS_BY_ROLE: ReadonlyMap<Role, ReadonlySet<Permission>> = new Map(
  Object.entries(MATRIX).map(([role, permissions]) => [
    role as Role,
    new Set<Permission>(permissions),
  ]),
);

/** Every role the matrix knows about. Used by the tests and by `toRole`. */
export const ROLES: readonly Role[] = Object.values(Role);

/** Every permission the application defines. */
export const PERMISSIONS: readonly Permission[] = Object.values(Permission);

/**
 * Narrows a role string from the database to a known role, or undefined.
 *
 * Fails closed by construction. A value the database holds that this enum does
 * not know about, which is what a migration adding an enum value without
 * updating this file would produce, resolves to undefined and therefore to no
 * permissions at all. The alternative, treating an unrecognised role as
 * ordinary, would grant it whatever the default happened to be.
 */
export function toRole(value: string | undefined): Role | undefined {
  return ROLES.find((role) => role === value);
}

/**
 * The known roles among a list read from the database.
 *
 * Unknown values are dropped rather than rejected, for the reason above: each
 * one grants nothing. A person holding one known role and one unknown keeps what
 * the known role allows and nothing more.
 */
export function toRoles(values: readonly string[] | undefined): ReadonlySet<Role> {
  const known = new Set<Role>();

  for (const value of values ?? []) {
    const role = toRole(value);

    if (role !== undefined) {
      known.add(role);
    }
  }

  return known;
}

/**
 * Whether a role holds a permission.
 *
 * An unknown role holds nothing, for the reason above.
 */
export function roleHasPermission(role: string | undefined, permission: Permission): boolean {
  const known = toRole(role);

  return known === undefined ? false : (PERMISSIONS_BY_ROLE.get(known)?.has(permission) ?? false);
}

/**
 * Whether any of a person's roles holds a permission.
 *
 * The union, deliberately. A teacher who is also a parent may do what either role
 * may do; what they may *see* is then narrowed by the access scope, which is
 * also an OR across their roles. No roles at all holds nothing.
 */
export function rolesHavePermission(
  roles: readonly string[] | undefined,
  permission: Permission,
): boolean {
  return (roles ?? []).some((role) => roleHasPermission(role, permission));
}

/**
 * Every permission a role holds.
 *
 * Returns a copy. `ReadonlySet` is a compile-time promise only: a caller can
 * cast it back to `Set` and call `add`, and if this handed out the live set
 * that would widen the matrix for the whole process at runtime. Nobody would do
 * that deliberately, which is precisely why it is worth making impossible.
 *
 * The copy costs an allocation per call, which is irrelevant here: the hot path
 * is `roleHasPermission`, which reads the internal map directly. This exists
 * for the matrix test and for logging.
 */
export function permissionsFor(role: Role): ReadonlySet<Permission> {
  return new Set<Permission>(PERMISSIONS_BY_ROLE.get(role));
}
