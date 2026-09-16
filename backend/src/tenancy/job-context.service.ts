import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { toRoles, type Role } from '../auth/permission.matrix';
import { runInJobContext } from './request-context';
import { TenantTransactionService } from './tenant-transaction.service';
import { rolesOfMembership } from './membership-roles';

interface MembershipRow {
  id: string;
}
/**
 * How background work establishes who it is acting as.
 *
 * This is the job-side equivalent of `MembershipTenantResolver`, and it is
 * deliberately the same shape: the caller names a school and a person, and the
 * **database** decides whether that pairing exists and what roles it carries.
 *
 * ## Why the roles are looked up rather than passed in
 *
 * An earlier version of this took the role as an argument, and a test caught
 * what that allows: a job could name any school and read it, because nothing
 * checked that its actor belonged there. Row-level security was working
 * exactly as designed. The membership policy admits a row when
 * `tenant_id = current_tenant_id()`, and the job had simply asserted a tenant.
 *
 * That is the same mistake `X-Tenant-Id` would have been on the HTTP side: an
 * assertion rather than a selection. The fix is the same too. The membership is
 * read first, under the actor's own user context, and the roles come off its role
 * rows. A job cannot name a school its actor is not in, and cannot claim a role
 * its actor does not hold, because it does not supply either.
 *
 * ## The boundary this completes
 *
 *     HTTP request    authn -> tenant resolution -> route permission
 *                           -> access scope -> row-level security
 *     Background job  this service (membership verified, roles read)
 *                           -> access scope -> row-level security
 *
 * The route permission step is absent from the second path because there is no
 * route, and its absence grants nothing: everything after it is identical.
 */
@Injectable()
export class JobContextService {
  constructor(private readonly transactions: TenantTransactionService) {}

  /**
   * Runs `work` as a member of a school, with both contexts open.
   *
   * Throws when the actor holds no live membership of that school, so a job
   * pointed at the wrong tenant fails loudly rather than reading it.
   */
  async runAsMember<T>(
    job: {
      /** What this work is, for the audit trail. */
      readonly jobName: string;
      /** The school the job acts within. */
      readonly tenantId: string;
      /** The person the job acts as. */
      readonly userId: string;
    },
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const roles = await this.rolesWithin(job.tenantId, job.userId);

    return runInJobContext({ ...job, roles }, () =>
      this.transactions.runInUserAndTenantContext(job.userId, job.tenantId, work),
    );
  }

  /**
   * The actor's roles in that school, or an error.
   *
   * Two statements in one transaction. The membership is read in a user context
   * alone, the same bootstrap path the request resolver uses: the membership
   * policy admits a row when `user_id = current_user_id()`, so this reads the
   * actor's own memberships and cannot see anyone else's. Only once that row
   * proves the actor belongs to the school is the tenant set, and the roles read
   * under it, because the role tables are tenant-isolated like everything else.
   */
  private async rolesWithin(tenantId: string, userId: string): Promise<Role[]> {
    const raw = await this.transactions.runInUserContext(userId, async (manager) => {
      const rows = await manager.query<MembershipRow[]>(
        `SELECT id
           FROM memberships
          WHERE user_id = $1
            AND tenant_id = $2
            AND status = 'ACTIVE'
            AND deleted_at IS NULL`,
        [userId, tenantId],
      );

      const membership = rows[0];

      if (!membership) {
        throw new Error(
          `Refusing to open a job context: the actor holds no live membership of school ` +
            `${tenantId}. A job acts as somebody, and that somebody has to belong where the job ` +
            'points. Naming a school is not the same as being in it.',
        );
      }

      return rolesOfMembership(manager, tenantId, membership.id);
    });

    const roles = [...toRoles(raw)];

    if (roles.length === 0) {
      throw new Error(
        `Refusing to open a job context: the actor belongs to school ${tenantId} but holds no ` +
          'role there, so there is nothing it may see.',
      );
    }

    return roles;
  }
}
