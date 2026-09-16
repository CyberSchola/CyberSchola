import type { DeepPartial, EntityManager } from 'typeorm';

import { type AccessScope, unrestrictedScope } from '../common/actions/access-scope';
import { TenantScopedAction } from '../common/actions/tenant-scoped.action';
import type { TenantOwnedEntity } from '../common/entities/tenant-owned.entity';
import type { Page, PageRequest } from '../common/pagination/pagination';

/**
 * Listing and creating one kind of academic record.
 *
 * Sessions, terms, grade levels, classes, subjects and the assignment tables all
 * list and create in exactly the same way. Ten copies of that would be ten places
 * for the scoped count or the tenant stamping to drift, so it is written once.
 *
 * The access scope is unrestricted because every member of a school may see its
 * academic structure: which classes exist, which subjects are taught. Who may
 * *change* it is decided by the permission on the route, and which *students* a
 * teacher may see is a different action with a real scope.
 *
 * Tenant stamping comes from `buildScoped`, so the school is taken from the
 * request context and a `tenantId` in the payload cannot redirect a write. The
 * database's WITH CHECK would reject it anyway; this rejects it earlier and more
 * clearly.
 */
export class RecordAction<TEntity extends TenantOwnedEntity> extends TenantScopedAction<TEntity> {
  protected readonly accessScope: AccessScope<TEntity> = unrestrictedScope<TEntity>();

  constructor(
    manager: EntityManager,
    entity: new () => TEntity,
    private readonly alias: string,
  ) {
    super(manager, entity);
  }

  /** One page, with the total derived from the same scoped query. */
  async list(page: PageRequest): Promise<Page<TEntity>> {
    const [items, total] = await this.scopedQuery(this.alias)
      .orderBy(`${this.alias}.createdAt`, 'ASC')
      .addOrderBy(`${this.alias}.id`, 'ASC')
      .take(page.limit)
      .skip(page.offset)
      .getManyAndCount();

    return { items, total, limit: page.limit, offset: page.offset };
  }

  /**
   * Creates a record in the current school.
   *
   * Constraint violations are not caught here. They propagate to the exception
   * filter, which maps a duplicate to 409, an overlap to 409, a reference to a
   * record outside this school to 404 and a check failure to 422, so every
   * resource reports the same mistake the same way.
   */
  async create(data: DeepPartial<TEntity>): Promise<TEntity> {
    return this.manager.save(this.buildScoped(data as Partial<TEntity>));
  }
}
