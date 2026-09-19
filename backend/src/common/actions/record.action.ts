import { type DeepPartial, type EntityManager, IsNull } from 'typeorm';

import { requireUserId } from '../../tenancy/request-context';
import type { TenantOwnedEntity } from '../entities/tenant-owned.entity';
import type { Page, PageRequest } from '../pagination/pagination';
import { type AccessScope, unrestrictedScope } from './access-scope';
import { TenantScopedAction } from './tenant-scoped.action';

/**
 * Listing, creating, changing and removing one kind of school record.
 *
 * The academic structure, the assignment tables and the people records all do
 * these in exactly the same way. A dozen copies would be a dozen places for the
 * scoped count, the tenant stamping or the soft delete to drift, so it is written
 * once.
 *
 * The access scope is unrestricted, so this is only for records where the route
 * permission is the whole rule: every member may see the academic structure, and
 * only an administrator may manage people. Anything where *which rows* depends on
 * the caller, such as students, uses an action with a real scope instead.
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
    private readonly entityClass: new () => TEntity,
    private readonly alias: string,
  ) {
    super(manager, entityClass);
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

  /**
   * One live record by id, or null.
   *
   * Null for a record in another school too: row-level security makes it not
   * exist, which is what lets the caller answer 404 in both cases.
   */
  async findById(id: string): Promise<TEntity | null> {
    return this.scopedQuery(this.alias)
      .andWhere(`${this.alias}.id = :__recordId`, { __recordId: id })
      .getOne();
  }

  /**
   * Applies changes to a live record and returns it, or null when there is none.
   *
   * `id`, `tenantId` and the lifecycle columns cannot be changed through here: the
   * update is keyed on the id, and the tenant is re-stamped from the context.
   */
  async update(id: string, changes: DeepPartial<TEntity>): Promise<TEntity | null> {
    const existing = await this.findById(id);

    if (!existing) {
      return null;
    }

    const merged = this.manager.merge(this.entityClass, existing, changes, {
      id: existing.id,
      tenantId: this.tenantId,
    } as DeepPartial<TEntity>);

    return this.manager.save(merged);
  }

  /**
   * Soft deletes a live record, recording who did it. False when there was none.
   *
   * Soft, per decision 8A: enrolments, guardianships and results keep pointing at
   * a removed record, and a partial unique index frees its identifying values for
   * reuse. `deleted_by` is the acting user, so a removal can always be attributed.
   */
  async softRemove(id: string): Promise<boolean> {
    const result = await this.manager.update(
      this.entityClass,
      { id, tenantId: this.tenantId, deletedAt: IsNull() },
      { deletedAt: new Date(), deletedBy: requireUserId() } as never,
    );

    return (result.affected ?? 0) > 0;
  }
}
