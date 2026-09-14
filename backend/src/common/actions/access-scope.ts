import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

import type { Role } from '../../auth/permission.matrix';

/** Who is asking, for the purpose of narrowing a query. */
export interface Actor {
  readonly userId: string;
  readonly role: Role;
}

/**
 * Narrows a query to the rows this caller may see, inside their own school.
 *
 * This is decision 13A, and it is a different question from the permission on
 * the route. "A teacher may list members" is a yes or no about the endpoint.
 * "A teacher may list *these* members" is a predicate on the query, and only
 * the second one can express the rule the product actually has.
 *
 * ## Why this is application code when tenant isolation is not
 *
 * The tenant boundary is an invariant: one fact, true for every table, that
 * must hold even if this codebase is wrong. It belongs in the database, and it
 * is there, in row-level security.
 *
 * An access scope is domain logic. It changes with every feature, and encoding
 * it as policy would mean the policy has to know about teaching loads, class
 * assignments and guardianship, so every feature becomes a migration and the
 * policies stop being readable. Keeping it here keeps it composable and
 * testable, and row-level security still holds the boundary underneath: a
 * mistake in a scope leaks a row to the wrong role *inside one school*, never
 * across schools.
 *
 * ## Why it narrows with EXISTS rather than a join
 *
 * A join against a membership or assignment table multiplies rows whenever the
 * join key is not unique, so a list endpoint starts returning duplicates and
 * the fix is `DISTINCT`, which costs more than the join saved. `EXISTS` cannot
 * change cardinality, short-circuits on the first match, and composes onto the
 * existing `WHERE` without touching the select list.
 */
export interface AccessScope<TEntity extends ObjectLiteral> {
  /**
   * True when this scope never narrows anything, for any role.
   *
   * Declared rather than inferred, because `TenantScopedAction` uses it to
   * refuse the find-options read path for entities that do have a scope. See
   * the note there: a `where` object cannot carry an `EXISTS`, so silently
   * applying no scope would return too much.
   */
  readonly unrestricted: boolean;

  /** Applies the narrowing, if this actor needs any. */
  restrict(query: SelectQueryBuilder<TEntity>, alias: string, actor: Actor): void;
}

/**
 * A scope that never narrows.
 *
 * For entities where every member of a school may see every row, which is a
 * real and common case. It exists so that `accessScope` can stay a required
 * member of every action: declaring "no rule here" is a decision somebody made,
 * and a reviewer can see it, whereas an omission is just an omission.
 */
export function unrestrictedScope<TEntity extends ObjectLiteral>(): AccessScope<TEntity> {
  return {
    unrestricted: true,
    restrict: () => undefined,
  };
}

/**
 * Builds a scope where some roles see everything and the rest are narrowed.
 *
 * The shape nearly every rule takes: an administrator sees the whole school,
 * everyone else sees some subset defined by their own relationship to the row.
 */
export function scopeFor<TEntity extends ObjectLiteral>(options: {
  /** Roles that see every row in the school. */
  readonly unrestrictedRoles: readonly Role[];
  /** Applied to everyone else. */
  readonly narrow: (query: SelectQueryBuilder<TEntity>, alias: string, actor: Actor) => void;
}): AccessScope<TEntity> {
  const privileged = new Set<Role>(options.unrestrictedRoles);

  return {
    unrestricted: false,
    restrict(query, alias, actor) {
      if (privileged.has(actor.role)) {
        return;
      }

      options.narrow(query, alias, actor);
    },
  };
}
