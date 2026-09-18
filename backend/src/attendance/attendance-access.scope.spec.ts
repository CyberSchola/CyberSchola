import type { SelectQueryBuilder } from 'typeorm';

import { Role } from '../auth/permission.matrix';
import type { Actor } from '../common/actions/access-scope';
import { attendanceScope } from './attendance-access.scope';

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

const scope = attendanceScope<object>();

/** The predicate the scope applied, as one string. */
function predicateFor(...roles: Role[]): string {
  const { query, applied } = recordingQuery();

  scope.restrict(query, 'attendance', actorWith(...roles));

  return applied.map((entry) => entry.sql).join(' ');
}

describe('the attendance access scope', () => {
  it('narrows nothing for an administrator', () => {
    const { query, applied } = recordingQuery();

    scope.restrict(query, 'attendance', actorWith(Role.SchoolAdmin));

    expect(applied).toEqual([]);
  });

  it('gives a member with no roles no rows at all, rather than every row', () => {
    // The dangerous default. Applying no predicate would hand the whole school
    // to exactly the people the rule forgot.
    expect(predicateFor()).toContain('FALSE');
  });

  it('tests a student column for the roles that are about students', () => {
    for (const role of [Role.Teacher, Role.Parent, Role.Student]) {
      expect(predicateFor(role)).toContain('attendance.studentId');
    }
  });

  it('gives a teacher their pupils and their own record, joined with OR', () => {
    const predicate = predicateFor(Role.Teacher);

    expect(predicate).toContain('attendance.studentId');
    expect(predicate).toContain('attendance.teacherId');
    expect(predicate).toContain(' OR ');
  });

  it('gives a staff member only their own record', () => {
    const predicate = predicateFor(Role.Staff);

    expect(predicate).toContain('attendance.staffId');
    expect(predicate).not.toContain('attendance.studentId');
  });

  it('gives a teacher who is also a parent the union of both rules', () => {
    const predicate = predicateFor(Role.Teacher, Role.Parent);

    // Their own record, their pupils, and their own children, all reachable.
    expect(predicate).toContain('attendance.teacherId');
    expect(predicate).toContain('guardianships');
    expect(predicate).toContain('class_supervisors');
  });

  it('binds each rule its own parameter, so several roles cannot collide', () => {
    const { query, applied } = recordingQuery();

    // Every role at once is the case where a shared parameter name would either
    // throw or, worse, silently bind one rule's value into another's.
    scope.restrict(
      query,
      'attendance',
      actorWith(Role.Teacher, Role.Parent, Role.Student, Role.Staff),
    );

    const params = applied.flatMap((entry) => Object.entries(entry.params));

    expect(params.length).toBeGreaterThan(1);

    for (const [, value] of params) {
      expect(value).toBe(USER);
    }
  });

  it('is never unrestricted, so the find-options read path stays refused', () => {
    // `TenantScopedAction` uses this flag to refuse `find`, which cannot carry a
    // scope. Declaring true here would silently return unscoped rows.
    expect(scope.unrestricted).toBe(false);
  });
});
