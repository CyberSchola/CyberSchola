import { Role } from '../auth/permission.matrix';

/**
 * The table whose live rows give a membership each role.
 *
 * One declaration, three consumers that must agree: the `membership_roles` view
 * unions exactly these tables, the Role enum names exactly these roles, and the
 * Postgres `memberships_role_enum` holds exactly these values. The role parity
 * tests read the view definition and the database enum and compare both against
 * this map, so adding a role without its table, or a table without its view
 * branch, fails the build instead of silently stripping that role from everyone
 * who holds it.
 *
 * `Record<Role, ...>` rather than a partial map on purpose: a new Role value that
 * is not added here is a compile error.
 */
export const ROLE_TABLES: Readonly<Record<Role, string>> = Object.freeze({
  [Role.SchoolAdmin]: 'school_admins',
  [Role.Teacher]: 'teachers',
  [Role.Student]: 'students',
  [Role.Parent]: 'parents',
  [Role.Staff]: 'staff',
});
