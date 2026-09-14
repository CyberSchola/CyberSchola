import { Injectable } from '@nestjs/common';

import { requireTenantId, requireUserId } from '../tenancy/request-context';
import { TenantTransactionService } from '../tenancy/tenant-transaction.service';
import { ListMembersAction, type MemberPage } from './list-members.action';

/** The shape the controller renders. */
export interface MemberSummary {
  id: string;
  userId: string;
  role: string;
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
    const page: MemberPage = await this.transactions.runInUserAndTenantContext(
      requireUserId(),
      requireTenantId(),
      async (manager) => new ListMembersAction(manager).execute(limit, offset),
    );

    return {
      items: page.items.map((member) => ({
        id: member.id,
        userId: member.userId,
        role: member.role,
        status: member.status,
      })),
      total: page.total,
    };
  }
}
