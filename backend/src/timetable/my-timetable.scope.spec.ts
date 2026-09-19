import type { SelectQueryBuilder } from 'typeorm';

import { Role } from '../auth/permission.matrix';
import type { Actor } from '../common/actions/access-scope';
import type { TimetableLesson } from './entities/timetable-lesson.entity';
import { myTimetableScope } from './my-timetable.scope';

const USER = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const actorWith = (...roles: Role[]): Actor => ({ userId: USER, roles: new Set(roles) });

/** What the scope applied to a query, as SQL and bindings. */
function applied(...roles: Role[]) {
  const recorded: Array<{ sql: string; params: Record<string, unknown> }> = [];
  const query = {
    andWhere: (sql: string, params: Record<string, unknown> = {}) => {
      recorded.push({ sql, params });

      return query;
    },
  };

  myTimetableScope().restrict(
    query as unknown as SelectQueryBuilder<TimetableLesson>,
    'lesson',
    actorWith(...roles),
  );

  return {
    sql: recorded.map((entry) => entry.sql).join(' '),
    params: Object.assign({}, ...recorded.map((entry) => entry.params)) as Record<string, unknown>,
  };
}

describe('whose week GET /me/timetable returns', () => {
  it('gives an administrator nothing of their own, rather than the whole school', () => {
    // "Mine" is not "the school's". An administrator reads any class or teacher
    // through those routes; this one must not quietly become a school dump.
    expect(applied(Role.SchoolAdmin).sql).toBe('FALSE');
  });

  it('gives staff, and a member with no roles, nothing', () => {
    expect(applied(Role.Staff).sql).toBe('FALSE');
    expect(applied().sql).toBe('FALSE');
  });

  it('gives a pupil core lessons by enrolment and electives by registration only', () => {
    const { sql } = applied(Role.Student);

    expect(sql).toMatch(/NOT lesson\.isElective AND lesson\.classId IN/);
    expect(sql).toMatch(/lesson\.isElective AND lesson\.classSubjectId IN/);
    expect(sql).toContain('FROM elective_registrations');
  });

  it("requires a pupil's registration to sit in a class they are enrolled in", () => {
    // A registration left behind by a pupil who changed class must show nothing.
    const { sql } = applied(Role.Student);
    const electives = sql.slice(sql.indexOf('FROM elective_registrations'));

    expect(electives).toContain('JOIN class_enrolments mts_enrolment');
    expect(electives).toContain('mts_enrolment.student_id = mts_registration.student_id');
  });

  it("gives a parent their children's lessons by the same rule a pupil's uses", () => {
    const { sql } = applied(Role.Parent);

    expect(sql).toContain('FROM guardianships');
    expect(sql).toMatch(/NOT lesson\.isElective AND lesson\.classId IN/);
  });

  it('gives a teacher the lessons they teach', () => {
    expect(applied(Role.Teacher).sql).toContain('lesson.teacherId IN');
  });

  it('gives a teacher who is a parent both, joined with OR', () => {
    const { sql } = applied(Role.Teacher, Role.Parent);

    expect(sql).toContain('lesson.teacherId IN');
    expect(sql).toContain('FROM guardianships');
    expect(sql).toMatch(/\) OR \(/);
  });

  it('binds every rule to the caller and nobody else', () => {
    const { params } = applied(Role.Student, Role.Parent, Role.Teacher);

    expect(Object.values(params).length).toBeGreaterThan(0);
    expect(new Set(Object.values(params))).toEqual(new Set([USER]));
  });

  it('never correlates with the outer row, so each set is computed once', () => {
    expect(applied(Role.Student, Role.Parent, Role.Teacher).sql).not.toMatch(/EXISTS\s*\(/i);
  });
});
