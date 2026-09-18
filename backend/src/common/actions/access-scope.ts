import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

import type { Role } from '../../auth/permission.matrix';

/** Who is asking, for the purpose of narrowing a query. */
export interface Actor {
  readonly userId: string;
  /** Every role the caller holds in this school. Possibly empty. */
  readonly roles: ReadonlySet<Role>;
}

/**
 * One role's reason for being allowed a row, as SQL.
 *
 * Pure data rather than a mutation of the query builder, so several roles'
 * fragments can be combined into a single OR. Parameter names must be unique to
 * the fragment's rule (prefix them), because every fragment for an actor lands in
 * the same query. A collision with a different value is refused rather than
 * silently overwritten.
 */
export interface ScopeFragment {
  readonly sql: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Builds a role's fragment for a query alias and an actor. */
export type FragmentBuilder = (alias: string, actor: Actor) => ScopeFragment;

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
 * Builds a scope where some roles see everything and the others are narrowed by
 * their own relationship to the row.
 *
 * ## Several roles, one OR
 *
 * A person can hold more than one role, and may see a row if **any** of their
 * roles allows it. A teacher who is also a parent sees their pupils and their own
 * children in one list. So each role declares its own fragment, and the fragments
 * for the actor's roles are joined with OR inside one bracket, which keeps the
 * tenant predicate that precedes it from being OR-ed away.
 *
 * ## Default deny, per role
 *
 * A role with no fragment contributes nothing. An actor whose roles contribute
 * nothing at all, including an actor with no roles, gets `FALSE`: the query runs
 * and returns no rows. That is deliberate. The alternative of applying no
 * predicate would hand the whole school to exactly the people the rule forgot.
 */
export function scopeFor<TEntity extends ObjectLiteral>(options: {
  /** Roles that see every row in the school. */
  readonly unrestrictedRoles: readonly Role[];
  /** The narrowing each remaining role gets. A role left out sees nothing. */
  readonly byRole: Readonly<Partial<Record<Role, FragmentBuilder>>>;
}): AccessScope<TEntity> {
  const privileged = new Set<Role>(options.unrestrictedRoles);

  return {
    unrestricted: false,
    restrict(query, alias, actor) {
      if ([...actor.roles].some((role) => privileged.has(role))) {
        return;
      }

      const combined = combineFragments(
        [...actor.roles]
          .map((role) => options.byRole[role])
          .filter((build): build is FragmentBuilder => build !== undefined)
          .map((build) => build(alias, actor)),
      );

      query.andWhere(combined.sql, combined.params);
    },
  };
}

/**
 * Joins fragments with OR, or yields `FALSE` for none.
 *
 * Identical fragments are kept once, so two roles sharing a rule (every
 * non-administrator sees their own membership, say) do not repeat it. Exported
 * for the unit tests and for callers that need the same predicate as a selected
 * flag rather than a filter.
 *
 * ## Identical means the SQL and the bindings
 *
 * Two fragments with the same SQL text are only the same rule if they bind the
 * same values. The same text bound to a different user id is a different rule,
 * and keeping one of them would silently drop the other's rows or, worse, keep
 * the wrong actor's. So a repeat is folded only when its bindings match exactly,
 * and refused otherwise. An earlier version keyed on the SQL alone and let the
 * second fragment replace the first before the parameter check below could see
 * the conflict, which contradicted the contract stated on `ScopeFragment`.
 */
export function combineFragments(fragments: readonly ScopeFragment[]): ScopeFragment {
  const unique = new Map<string, ScopeFragment>();

  for (const fragment of fragments) {
    const seen = unique.get(fragment.sql);

    if (seen !== undefined && !sameBindings(seen.params, fragment.params)) {
      throw new Error(
        'Two access-scope fragments share their SQL but bind different values. They are two ' +
          'different rules, and folding them into one would silently drop one of them.',
      );
    }

    unique.set(fragment.sql, fragment);
  }

  if (unique.size === 0) {
    return { sql: 'FALSE', params: {} };
  }

  const params: Record<string, unknown> = {};

  for (const fragment of unique.values()) {
    for (const [name, value] of Object.entries(fragment.params)) {
      if (name in params && params[name] !== value) {
        throw new Error(
          `Two access-scope fragments bind the parameter "${name}" to different values. ` +
            "Prefix each fragment's parameter names with its rule, so they cannot collide.",
        );
      }

      params[name] = value;
    }
  }

  return {
    sql: `(${[...unique.keys()].map((sql) => `(${sql})`).join(' OR ')})`,
    params,
  };
}

/** Whether two fragments bind exactly the same names to exactly the same values. */
function sameBindings(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const names = Object.keys(left);

  return (
    names.length === Object.keys(right).length &&
    names.every((name) => name in right && Object.is(left[name], right[name]))
  );
}
