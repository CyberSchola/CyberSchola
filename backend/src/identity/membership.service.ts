import { Injectable } from '@nestjs/common';

import { TenantTransactionService } from '../tenancy/tenant-transaction.service';

/** A school the caller belongs to, and what they are in it. */
export interface SchoolMembership {
  id: string;
  name: string;
  slug: string;
  role: string;
}

@Injectable()
export class MembershipService {
  constructor(private readonly transactions: TenantTransactionService) {}

  /**
   * The schools this user belongs to.
   *
   * Runs in a user context with no tenant, which is the one place that is both
   * legitimate and necessary: the caller has not chosen a school yet, and this
   * is the query that tells them what there is to choose from.
   *
   * Two policies do the work and neither is application code. `memberships`
   * returns rows where `user_id = current_user_id()`, and `tenants` returns a
   * school only when the caller has a live membership of it. So the join cannot
   * reach a school the caller does not belong to even if this query were
   * written wrongly.
   */
  async schoolsFor(userId: string): Promise<SchoolMembership[]> {
    return this.transactions.runInUserContext(userId, async (manager) =>
      manager.query<SchoolMembership[]>(
        `SELECT t.id, t.name, t.slug::text AS slug, m.role
           FROM memberships m
           JOIN tenants t ON t.id = m.tenant_id
          WHERE m.user_id = $1
            AND m.status = 'ACTIVE'
            AND m.deleted_at IS NULL
            AND t.deleted_at IS NULL
          ORDER BY t.name`,
        [userId],
      ),
    );
  }
}
