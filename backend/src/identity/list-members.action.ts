import type { EntityManager } from 'typeorm';

import { Role } from '../auth/permission.matrix';
import { type AccessScope, scopeFor } from '../common/actions/access-scope';
import { TenantScopedAction } from '../common/actions/tenant-scoped.action';
import { Membership } from './membership.entity';

/** A page of members, and how many there are in total for this caller. */
export interface MemberPage {
  readonly items: Membership[];
  readonly total: number;
}

/**
 * Listing the people in a school.
 *
 * The first real consumer of decision 13A, and the reason the access scope was
 * built against something rather than invented in the abstract.
 *
 * The rule: a school administrator sees everyone in the school; everyone else
 * sees only their own membership. Note that all five roles hold
 * `Permission.MembershipRead`, so the permission check on the route lets them
 * all through. The narrowing happens here. Conflating the two would have meant
 * either denying teachers the endpoint or handing them the whole school.
 */
export class ListMembersAction extends TenantScopedAction<Membership> {
  constructor(manager: EntityManager) {
    super(manager, Membership);
  }

  /**
   * Narrows to the caller's own row for anyone who is not an administrator.
   *
   * A plain predicate rather than an `EXISTS`, because the relationship being
   * tested lives on this table: the row *is* the membership. An `EXISTS` is
   * what the same pattern needs once the relationship is elsewhere, such as a
   * teacher reaching a class through an assignment table, which is why the
   * helper supports it.
   */
  protected readonly accessScope: AccessScope<Membership> = scopeFor<Membership>({
    unrestrictedRoles: [Role.SchoolAdmin],
    narrow: (query, alias, actor) =>
      void query.andWhere(`${alias}.userId = :__actorId`, { __actorId: actor.userId }),
  });

  /**
   * One page of members, with the total for the same scope.
   *
   * The count runs through the same builder as the rows, deliberately. Scoping
   * the list and leaving the total unscoped is the classic version of this bug:
   * the rows are hidden and the number still tells you how many exist. Deriving
   * both from one query makes them impossible to disagree.
   */
  async execute(limit: number, offset: number): Promise<MemberPage> {
    // No explicit deletedAt filter. The entity carries a @DeleteDateColumn, so
    // TypeORM's query builder excludes soft-deleted rows unless withDeleted()
    // is called. That is asserted by a test rather than assumed, because a
    // silent change in that behaviour would start returning removed people.
    const query = this.scopedQuery('membership')
      .orderBy('membership.createdAt', 'ASC')
      .take(limit)
      .skip(offset);

    const [items, total] = await query.getManyAndCount();

    return { items, total };
  }
}
