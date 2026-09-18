import type { EntityManager } from 'typeorm';

/**
 * The roles a membership holds, read inside its school.
 *
 * The role tables are tenant-isolated, so their rows are invisible until the
 * transaction names a school. This is called only after the membership itself
 * has been read under the caller's user context, which is what proves the caller
 * belongs to that school. Setting the tenant here is therefore a selection from
 * what the database already confirmed, never an assertion.
 *
 * `set_config(..., true)` is transaction-local, so the tenant stays in place for
 * the rest of the caller's transaction and disappears with it. Nothing leaks to
 * the next request on a pooled connection.
 *
 * Reads the `membership_roles` view, which is `security_invoker`: the policies on
 * the five role tables apply as if they were queried directly.
 */
export async function rolesOfMembership(
  manager: EntityManager,
  tenantId: string,
  membershipId: string,
): Promise<string[]> {
  await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

  const rows = await manager.query<Array<{ role: string }>>(
    `SELECT role::text AS role
       FROM membership_roles
      WHERE membership_id = $1
        AND tenant_id = $2
      ORDER BY role`,
    [membershipId, tenantId],
  );

  return rows.map((row) => row.role);
}
