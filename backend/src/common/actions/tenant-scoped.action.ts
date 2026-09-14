import type {
  EntityManager,
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
  ObjectLiteral,
  SelectQueryBuilder,
} from 'typeorm';

import { toRole } from '../../auth/permission.matrix';
import type { TenantOwnedEntity } from '../entities/tenant-owned.entity';
import { getRequestContext, requireTenantId, requireUserId } from '../../tenancy/request-context';
import type { AccessScope, Actor } from './access-scope';

/**
 * Base for every action that touches school data.
 *
 * The application half of decision 1A. Row-level security is the guarantee;
 * this is the ergonomics that keep developers from fighting it. Without a
 * tenant predicate in the query, RLS still returns the right rows, but the
 * database does the filtering after the planner has considered every row in
 * the table, and a `findOne` by id silently returns nothing with no
 * explanation. Adding the predicate here makes the intent explicit and lets
 * the tenant index do its job.
 *
 * The two layers are deliberately not redundant. If this class is bypassed,
 * RLS still holds. If RLS were somehow disabled, this still scopes. Decision
 * 1A chose both because either alone has a plausible failure mode.
 *
 * `tenantId` is never a parameter. It comes from the request context, so there
 * is no call site where a caller passes one in and no opportunity to pass the
 * wrong one. A job with no request must open a context explicitly via
 * `TenantTransactionService`, which is why job payloads carry their own tenant
 * id.
 */
export abstract class TenantScopedAction<TEntity extends TenantOwnedEntity & ObjectLiteral> {
  protected constructor(
    protected readonly manager: EntityManager,
    private readonly entity: new () => TEntity,
  ) {}

  /**
   * Which rows this caller may see, beyond the tenant boundary.
   *
   * Abstract, not optional, so it cannot be forgotten: an action that does not
   * declare one does not compile. Entities with no row-level rule say so with
   * `unrestrictedScope()`, which is a decision a reviewer can see rather than
   * an omission nobody notices.
   */
  protected abstract readonly accessScope: AccessScope<TEntity>;

  /** The school this action is operating within. Throws outside a context. */
  protected get tenantId(): string {
    return requireTenantId();
  }

  /**
   * Who is asking.
   *
   * Both fields come from the membership row, resolved once per request. A role
   * the enum does not recognise is refused rather than defaulted, so adding a
   * value to the database enum without adding it here denies access instead of
   * granting something arbitrary.
   */
  protected get actor(): Actor {
    const role = toRole(getRequestContext()?.role);

    if (role === undefined) {
      throw new Error(
        'The request context carries no recognised role, so the rows this caller may see ' +
          'cannot be determined. A role stored in memberships that is missing from the Role ' +
          'enum will land here.',
      );
    }

    return { userId: requireUserId(), role };
  }

  /**
   * A `where` clause already scoped to the tenant.
   *
   * Merges rather than replaces, so a caller's own conditions survive. Note the
   * tenant is applied last: a caller cannot override it by passing their own
   * `tenantId`, because this one wins.
   */
  protected scopedWhere(where: FindOptionsWhere<TEntity> = {}): FindOptionsWhere<TEntity> {
    return { ...where, tenantId: this.tenantId };
  }

  /** Finds many rows within the tenant. */
  protected async findScoped(options: FindManyOptions<TEntity> = {}): Promise<TEntity[]> {
    this.assertScopeExpressible('findScoped');

    return this.manager.find(this.entity, {
      ...options,
      where: this.mergeWhere(options.where),
    });
  }

  /**
   * Finds one row within the tenant.
   *
   * A row belonging to another school is not "forbidden" here, it simply does
   * not exist. That is what makes decision 6A's 404 honest rather than a
   * disguise: by the time a caller reaches the service layer, there is nothing
   * to disguise.
   */
  protected async findOneScoped(options: FindOneOptions<TEntity>): Promise<TEntity | null> {
    this.assertScopeExpressible('findOneScoped');

    return this.manager.findOne(this.entity, {
      ...options,
      where: this.mergeWhere(options.where),
    });
  }

  /** Counts rows within the tenant. */
  protected async countScoped(options: FindManyOptions<TEntity> = {}): Promise<number> {
    this.assertScopeExpressible('countScoped');

    return this.manager.count(this.entity, {
      ...options,
      where: this.mergeWhere(options.where),
    });
  }

  /**
   * Stamps a new row with the current tenant.
   *
   * Applied after the caller's fields, so a payload carrying its own
   * `tenantId` cannot smuggle a row into another school. The database would
   * reject it anyway through `WITH CHECK`, but failing here gives a clearer
   * error than a policy violation from deep in the driver.
   */
  protected buildScoped(data: Partial<TEntity>): TEntity {
    return this.manager.create(this.entity, {
      ...data,
      tenantId: this.tenantId,
    } as never);
  }

  /**
   * A query builder with the tenant predicate already applied.
   *
   * For anything a `where` object cannot express: joins, aggregates,
   * subqueries. Decision 13A's access-scope subqueries will compose onto this.
   */
  protected scopedQuery(alias: string): SelectQueryBuilder<TEntity> {
    const query = this.manager
      .createQueryBuilder(this.entity, alias)
      .where(`${alias}.tenantId = :__tenantId`, { __tenantId: this.tenantId });

    // Applied here rather than by each caller. Welding it to the only method
    // that produces a query builder is the same reasoning as welding the
    // application grant to apply_tenant_isolation: a step that has to be
    // remembered separately is a step that will eventually be skipped, and
    // skipping this one fails silently by returning too much.
    this.accessScope.restrict(query, alias, this.actor);

    return query;
  }

  /**
   * Refuses the find-options read path when the entity has an access scope.
   *
   * TypeORM's `where` object cannot carry an `EXISTS`, so there is no way to
   * apply a scope through `find`. The honest options were to silently return
   * unscoped rows, or to stop. Stopping is loud, happens the first time the
   * method is called, and the message says exactly what to use instead.
   */
  private assertScopeExpressible(method: string): void {
    if (!this.accessScope.unrestricted) {
      throw new Error(
        `${method} cannot apply this entity's access scope, because a find-options where ` +
          'clause cannot express one. Use scopedQuery() instead, which applies it.',
      );
    }
  }

  /**
   * Applies the tenant to a where clause that may be a single object or an
   * array of them.
   *
   * TypeORM treats an array as OR. Scoping only the first element would leave
   * every other branch unscoped, which is the kind of partial fix that looks
   * correct in review.
   */
  private mergeWhere(
    where: FindManyOptions<TEntity>['where'],
  ): FindOptionsWhere<TEntity> | FindOptionsWhere<TEntity>[] {
    if (Array.isArray(where)) {
      return where.map((clause) => this.scopedWhere(clause));
    }

    return this.scopedWhere(where);
  }
}
