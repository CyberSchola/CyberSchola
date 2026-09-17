import {
  PERMISSIONS,
  Permission,
  ROLES,
  Role,
  permissionsFor,
  roleHasPermission,
  toRole,
} from './permission.matrix';

/**
 * The matrix is the security policy. Everything else in this area is plumbing.
 *
 * It is asserted exhaustively rather than sampled, so that changing what a role
 * may do cannot land without editing an assertion here. A privilege change then
 * appears twice in the diff, and a reviewer has to agree with it in both
 * places. The untested cells would otherwise be exactly where a mistake hides,
 * and nobody ever knows which cells those are.
 *
 * The table below doubles as the readable statement of what each role is.
 */
describe('the permission matrix', () => {
  /** Every cell, stated. Ordered role by role so it reads as a specification. */
  const EXPECTED: Readonly<Record<Role, readonly Permission[]>> = {
    [Role.SchoolAdmin]: [
      Permission.MembershipRead,
      Permission.MembershipWrite,
      Permission.SchoolRead,
      Permission.SchoolUpdate,
    ],
    [Role.Teacher]: [Permission.MembershipRead, Permission.SchoolRead],
    [Role.Student]: [Permission.MembershipRead, Permission.SchoolRead],
    [Role.Parent]: [Permission.MembershipRead, Permission.SchoolRead],
    [Role.Staff]: [Permission.MembershipRead, Permission.SchoolRead],
  };

  describe.each(ROLES)('%s', (role) => {
    it.each(PERMISSIONS)('%s', (permission) => {
      const granted = EXPECTED[role].includes(permission);

      expect(roleHasPermission(role, permission)).toBe(granted);
    });
  });

  it('covers every role, so a new role cannot slip past this suite', () => {
    // If a role is added to the enum and not to EXPECTED above, the describe
    // block iterates it against an undefined entry and throws. This states the
    // same thing directly, so the failure is legible rather than a TypeError.
    expect(Object.keys(EXPECTED).sort()).toEqual([...ROLES].sort());
  });

  it('grants membership.read to every role', () => {
    // Deliberate, and worth pinning. "May you use this endpoint" is not "which
    // rows may you see". Every role may list members; the access scope narrows
    // the result. Revoking this from a role would deny them the endpoint
    // outright, which is a different and much larger change than it looks.
    for (const role of ROLES) {
      expect(roleHasPermission(role, Permission.MembershipRead)).toBe(true);
    }
  });

  it('gives write permissions to the school administrator alone', () => {
    const writers = ROLES.filter(
      (role) =>
        roleHasPermission(role, Permission.MembershipWrite) ||
        roleHasPermission(role, Permission.SchoolUpdate),
    );

    expect(writers).toEqual([Role.SchoolAdmin]);
  });

  describe('an unrecognised role', () => {
    it.each(['SUPER_ADMIN', 'ADMIN', 'root', '', 'school_admin'])(
      'holds nothing: %p',
      (unknown) => {
        // Fails closed. A value stored in memberships.role that this enum does
        // not know about, which is what a migration adding an enum value
        // without updating the matrix produces, must grant nothing rather than
        // fall through to a default. Note 'school_admin' in lower case is also
        // rejected: the comparison is exact, not case-insensitive.
        for (const permission of PERMISSIONS) {
          expect(roleHasPermission(unknown, permission)).toBe(false);
        }
      },
    );

    it('holds nothing when the role is absent entirely', () => {
      for (const permission of PERMISSIONS) {
        expect(roleHasPermission(undefined, permission)).toBe(false);
      }
    });
  });

  describe('toRole', () => {
    it.each(ROLES)('recognises %s', (role) => {
      expect(toRole(role)).toBe(role);
    });

    it.each(['SUPER_ADMIN', 'teacher', ' TEACHER', undefined])('rejects %p', (value) => {
      expect(toRole(value)).toBeUndefined();
    });
  });

  describe('permissionsFor', () => {
    it('returns a set that cannot be used to widen the matrix', () => {
      // The caller gets a view, not the live set. Mutating it must not grant
      // anyone anything, and a test is the only thing that keeps that true if
      // the implementation stops copying.
      const before = roleHasPermission(Role.Teacher, Permission.SchoolUpdate);
      const teacher = permissionsFor(Role.Teacher) as Set<Permission>;

      try {
        teacher.add(Permission.SchoolUpdate);
      } catch {
        // A frozen or readonly set throwing here is an equally good outcome.
      }

      expect(roleHasPermission(Role.Teacher, Permission.SchoolUpdate)).toBe(before);
    });
  });
});
