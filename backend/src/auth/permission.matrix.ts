/**
 * Roles a membership can carry.
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
  /** Send a message to the AI assistant. Granted to every role: AI-02 has no
   *  tool/data access yet, so this only gates reaching the model itself. */
  AiChat = 'ai.chat',
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
    Permission.AiChat,
  ],
  [Role.Teacher]: [Permission.MembershipRead, Permission.SchoolRead, Permission.AiChat],
  [Role.Student]: [Permission.MembershipRead, Permission.SchoolRead, Permission.AiChat],
  [Role.Parent]: [Permission.MembershipRead, Permission.SchoolRead, Permission.AiChat],
  [Role.Staff]: [Permission.MembershipRead, Permission.SchoolRead, Permission.AiChat],
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
 * Fails closed by construction. A value stored in `memberships.role` that this
 * enum does not know about, which is what a migration adding an enum value
 * without updating this file would produce, resolves to undefined and therefore
 * to no permissions at all. The alternative, treating an unrecognised role as
 * ordinary, would grant it whatever the default happened to be.
 */
export function toRole(value: string | undefined): Role | undefined {
  return ROLES.find((role) => role === value);
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