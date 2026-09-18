import type { DataSource } from 'typeorm';

import { Role } from '../src/auth/permission.matrix';
import { ROLE_TABLES } from '../src/people/role-tables';

/** A seeded member: their membership, and the role row that gives them each role. */
export interface SeededMember {
  readonly membershipId: string;
  readonly roleRows: Readonly<Partial<Record<Role, string>>>;
}

/**
 * Seeds a membership and the role rows that give it roles, as the owner.
 *
 * Since BE-P01 a role is a row in its role table pointing at the membership, not
 * a column on it, so every suite that needs "a teacher" or "a parent" goes
 * through here. Seeding as the owner bypasses row-level security on purpose:
 * fixtures describe the world, and the suites then prove what the restricted
 * role can see of it.
 *
 * @param roles Every role the person holds. Empty is a real state: a member who
 *   has been added to a school and not yet given anything to do there.
 */
export async function seedMember(
  owner: DataSource,
  tenantId: string,
  userId: string,
  roles: readonly Role[] = [],
  options: { readonly status?: 'ACTIVE' | 'SUSPENDED'; readonly deleted?: boolean } = {},
): Promise<SeededMember> {
  // Created active and given its roles first, then suspended or removed, which is
  // the only order the database allows: a role can only be granted to a live,
  // active membership. It is also the order it happens in a school.
  const [membership] = await owner.query<Array<{ id: string }>>(
    `INSERT INTO memberships (tenant_id, user_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [tenantId, userId],
  );

  const roleRows: Partial<Record<Role, string>> = {};

  for (const role of roles) {
    roleRows[role] = await seedRoleRow(owner, tenantId, role, membership.id);
  }

  if (options.status === 'SUSPENDED') {
    await owner.query(`UPDATE memberships SET status = 'SUSPENDED' WHERE id = $1`, [membership.id]);
  }

  // Removing ends the roles, per migration 1757700400000: an administrator row is
  // soft-deleted and a person record is unlinked. The ids above still name the
  // rows, so a suite can check what became of them.
  if (options.deleted === true) {
    await owner.query(`UPDATE memberships SET deleted_at = now() WHERE id = $1`, [membership.id]);
  }

  return { membershipId: membership.id, roleRows };
}

/**
 * Seeds one role row, linked to a membership or, for a record with no login yet,
 * to nothing.
 */
export async function seedRoleRow(
  owner: DataSource,
  tenantId: string,
  role: Role,
  membershipId: string | null,
  names: { readonly firstName?: string; readonly lastName?: string } = {},
): Promise<string> {
  const table = ROLE_TABLES[role];

  const [row] =
    role === Role.SchoolAdmin
      ? await owner.query<Array<{ id: string }>>(
          `INSERT INTO ${table} (tenant_id, membership_id) VALUES ($1, $2) RETURNING id`,
          [tenantId, membershipId],
        )
      : await owner.query<Array<{ id: string }>>(
          `INSERT INTO ${table} (tenant_id, membership_id, first_name, last_name)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenantId, membershipId, names.firstName ?? 'Test', names.lastName ?? role.toLowerCase()],
        );

  return row.id;
}
