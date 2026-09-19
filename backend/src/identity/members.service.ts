import { Injectable } from '@nestjs/common';

import { requireTenantId, requireUserId } from '../tenancy/request-context';
import { TenantTransactionService } from '../tenancy/tenant-transaction.service';
import { ListMembersAction, type MemberPage } from './list-members.action';

/** The shape the controller renders. */
export interface MemberSummary {
  id: string;
  userId: string;
  roles: string[];
  status: string;
}

export interface MemberPageResult {
  items: MemberSummary[];
  total: number;
}

@Injectable()
export class MembersService {
  constructor(private readonly transactions: TenantTransactionService) {}

  /**
   * One page of the current school's members.
   *
   * Runs with both the user and the tenant in session, which is what the two
   * layers need. Row-level security filters to the school; the action's access
   * scope narrows further to what this particular caller may see. Neither is a
   * substitute for the other: if the scope were wrong, the caller would see too
   * much of their own school and still nothing of anyone else's.
   */
  async list(limit: number, offset: number): Promise<MemberPageResult> {
    return this.transactions.runInUserAndTenantContext(
      requireUserId(),
      requireTenantId(),
      async (manager) => {
        const page: MemberPage = await new ListMembersAction(manager).execute(limit, offset);

        // One query for the whole page's roles rather than one per member. The ids
        // come from the scoped page, and the view is security_invoker, so this can
        // only ever return roles for rows the caller was already allowed to see.
        const ids = page.items.map((member) => member.id);
        const rows =
          ids.length === 0
            ? []
            : await manager.query<Array<{ membership_id: string; roles: string[] }>>(
                `SELECT membership_id, array_agg(role::text ORDER BY role) AS roles
                   FROM membership_roles
                  WHERE membership_id = ANY($1::uuid[])
                  GROUP BY membership_id`,
                [ids],
              );
        const rolesById = new Map(rows.map((row) => [row.membership_id, row.roles]));

        return {
          items: page.items.map((member) => ({
            id: member.id,
            userId: member.userId,
            roles: rolesById.get(member.id) ?? [],
            status: member.status,
          })),
          total: page.total,
        };
      },
    );
  }
}
