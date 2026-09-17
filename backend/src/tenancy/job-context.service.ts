import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { toRole, type Role } from '../auth/permission.matrix';
import { enterVerifiedJobContext } from './request-context';
import { TenantTransactionService } from './tenant-transaction.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface MembershipRow {
  id: string;
  role: string;
}

/**
 * How background work establishes who it is acting as.
 *
 * This is the job-side equivalent of `MembershipTenantResolver`, and it is
 * deliberately the same shape: the caller names a school and a person, and the
 * **database** decides whether that pairing exists and what role it carries.
 *
 * ## Why the role is looked up rather than passed in
 *
 * An earlier version of this took the role as an argument, and a test caught
 * what that allows: a job could name any school and read it, because nothing
 * checked that its actor belonged there. Row-level security was working
 * exactly as designed. The membership policy admits a row when
 * `tenant_id = current_tenant_id()`, and the job had simply asserted a tenant.
 *
 * That is the same mistake `X-Tenant-Id` would have been on the HTTP side: an
 * assertion rather than a selection. The fix is the same too. The membership is
 * read first, under the actor's own user context, and the role comes off that
 * row. A job cannot name a school its actor is not in, and cannot claim a role
 * its actor does not hold, because it does not supply either.
 *
 * ## The boundary this completes
 *
 *     HTTP request    authn -> tenant resolution -> route permission
 *                           -> access scope -> row-level security
 *     Background job  this service (membership verified, role read)
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
    // Checked before the database is touched, so a malformed job never even
    // reads a membership.
    if (job.jobName.trim() === '') {
      throw new Error('A job context needs a jobName, so an audit line can say what ran.');
    }

    if (!UUID_PATTERN.test(job.tenantId)) {
      throw new Error('Refusing to open a job context for a non-uuid tenant id.');
    }

    if (!UUID_PATTERN.test(job.userId)) {
      throw new Error('Refusing to open a job context for a non-uuid user id.');
    }

    const membership = await this.membershipWithin(job.tenantId, job.userId);

    // Built field by field from the verified row, never by spreading the job.
    // Spreading would carry through anything else a caller attached, such as a
    // `role` smuggled in with a cast.
    return enterVerifiedJobContext(
      {
        jobName: job.jobName,
        tenantId: job.tenantId,
        userId: job.userId,
        membershipId: membership.id,
        role: membership.role,
      },
      () => this.transactions.runInUserAndTenantContext(job.userId, job.tenantId, work),
    );
  }

  /**
   * The actor's live membership of that school, and the role on it, or an error.
   *
   * Runs in a user context and nothing else, which is the same bootstrap path
   * the request resolver uses: the membership policy admits a row when
   * `user_id = current_user_id()`, so this reads the actor's own memberships
   * and cannot see anyone else's. With no tenant set, the other half of that
   * policy is false, so naming a school here proves nothing by itself.
   */
  private async membershipWithin(
    tenantId: string,
    userId: string,
  ): Promise<{ id: string; role: Role }> {
    const rows = await this.transactions.runInUserContext(userId, async (manager) =>
      manager.query<MembershipRow[]>(
        `SELECT id, role
           FROM memberships
          WHERE user_id = $1
            AND tenant_id = $2
            AND status = 'ACTIVE'
            AND deleted_at IS NULL`,
        [userId, tenantId],
      ),
    );

    const found = rows[0];

    if (!found) {
      throw new Error(
        `Refusing to open a job context: the actor holds no live membership of school ` +
          `${tenantId}. A job acts as somebody, and that somebody has to belong where the job ` +
          'points. Naming a school is not the same as being in it.',
      );
    }

    const role = toRole(found.role);

    if (role === undefined) {
      // Fails closed on a role the matrix does not know, exactly as the request
      // path does. A job must not be how an unrecognised role gets in.
      throw new Error(
        `The membership carries the role "${found.role}", which is not in the Role enum. ` +
          'A migration added a database enum value without updating the application.',
      );
    }

    return { id: found.id, role };
  }
}
