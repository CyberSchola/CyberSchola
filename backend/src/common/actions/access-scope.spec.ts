import type { SelectQueryBuilder } from 'typeorm';

import { Role } from '../../auth/permission.matrix';
import { type Actor, combineFragments, scopeFor, type ScopeFragment } from './access-scope';

const USER = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const actorWith = (...roles: Role[]): Actor => ({ userId: USER, roles: new Set(roles) });

/** A query builder that records what the scope applied to it. */
function recordingQuery() {
  const applied: Array<{ sql: string; params: Record<string, unknown> }> = [];
  const query = {
    andWhere: (sql: string, params: Record<string, unknown> = {}) => {
      applied.push({ sql, params });
      return query;
    },
  };

  return { query: query as unknown as SelectQueryBuilder<object>, applied };
}

const teacherBranch = (alias: string, actor: Actor): ScopeFragment => ({
  sql: `${alias}.teacher = :__t`,
  params: { __t: actor.userId },
});
const parentBranch = (alias: string, actor: Actor): ScopeFragment => ({
  sql: `${alias}.parent = :__p`,
  params: { __p: actor.userId },
});

const scope = scopeFor<object>({
  unrestrictedRoles: [Role.SchoolAdmin],
  byRole: { [Role.Teacher]: teacherBranch, [Role.Parent]: parentBranch },
});

describe('scopeFor', () => {
  it('applies nothing to an unrestricted role', () => {
    const { query, applied } = recordingQuery();

    scope.restrict(query, 'row', actorWith(Role.SchoolAdmin));

    expect(applied).toEqual([]);
  });

  it('applies nothing when any one of several roles is unrestricted', () => {
    // An administrator who is also a parent is an administrator.
    const { query, applied } = recordingQuery();

    scope.restrict(query, 'row', actorWith(Role.Parent, Role.SchoolAdmin));

    expect(applied).toEqual([]);
  });

  it("applies one role's branch on its own", () => {
    const { query, applied } = recordingQuery();

    scope.restrict(query, 'row', actorWith(Role.Teacher));

    expect(applied).toEqual([{ sql: '((row.teacher = :__t))', params: { __t: USER } }]);
  });

  it('ORs the branches of every role the person holds, inside one bracket', () => {
    // The outer bracket is what stops the OR from escaping and swallowing the
    // tenant predicate that precedes it in the WHERE clause.
    const { query, applied } = recordingQuery();

    scope.restrict(query, 'row', actorWith(Role.Teacher, Role.Parent));

    expect(applied).toHaveLength(1);
    expect(applied[0]?.sql).toBe('((row.teacher = :__t) OR (row.parent = :__p))');
    expect(applied[0]?.params).toEqual({ __t: USER, __p: USER });
  });

  it('denies a role that declares no branch, rather than leaving the query open', () => {
    const { query, applied } = recordingQuery();

    scope.restrict(query, 'row', actorWith(Role.Staff));

    expect(applied).toEqual([{ sql: 'FALSE', params: {} }]);
  });

  it('denies a person with no roles at all', () => {
    const { query, applied } = recordingQuery();

    scope.restrict(query, 'row', actorWith());

    expect(applied).toEqual([{ sql: 'FALSE', params: {} }]);
  });

  it('ignores the branchless role beside a role with a branch', () => {
    const { query, applied } = recordingQuery();

    scope.restrict(query, 'row', actorWith(Role.Staff, Role.Teacher));

    expect(applied[0]?.sql).toBe('((row.teacher = :__t))');
  });

  it('declares itself restricted, so the find-options read path is refused', () => {
    expect(scope.unrestricted).toBe(false);
  });
});

describe('combineFragments', () => {
  it('keeps an identical fragment once', () => {
    const same = { sql: 'row.user = :__u', params: { __u: USER } };

    expect(combineFragments([same, same]).sql).toBe('((row.user = :__u))');
  });

  it('refuses two fragments that bind one parameter name to different values', () => {
    // Otherwise the second silently overwrites the first, and one branch runs
    // with the other's value.
    expect(() =>
      combineFragments([
        { sql: 'a = :__x', params: { __x: 'one' } },
        { sql: 'b = :__x', params: { __x: 'two' } },
      ]),
    ).toThrow(/__x/);
  });

  it('yields FALSE for no fragments', () => {
    expect(combineFragments([])).toEqual({ sql: 'FALSE', params: {} });
  });
});
