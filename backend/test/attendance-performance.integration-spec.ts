import { DataSource } from 'typeorm';

import { ReadAttendanceAction } from '../src/attendance/read-attendance.action';
import { Role } from '../src/auth/permission.matrix';
import { rolesOfMembership } from '../src/tenancy/membership-roles';
import { runWithRequestContext } from '../src/tenancy/request-context';
import { APP_ROLE_PASSWORD } from './app-database.env';
import { seedAcademicYear, seedClass } from './attendance.fixtures';
import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';
import { seedMember } from './people.fixtures';

/**
 * The read paths, on a school large enough for a mistake to show.
 *
 * Blueprint section 54 is about schools with thousands of students, and
 * attendance is the largest table any of them will have: 2,000 children times
 * 180 school days is over a third of a million rows in one year. This suite
 * seeds 120,000 and asserts on the query plan.
 *
 * ## Why the plan rather than a stopwatch
 *
 * The regression this is guarding against has happened once already. In BE-P01
 * the teacher access rule was a correlated `EXISTS`, which read beautifully and
 * took 1.46 seconds for a teacher's first page on a 2,000-student school,
 * because the subquery ran again for every row. Rewritten as an uncorrelated set
 * tested with `IN`, the same query took 9 milliseconds.
 *
 * A wall-clock budget would catch that, and would also go red on a busy runner
 * for reasons that have nothing to do with the code, so it would have to be set
 * loose enough that a threefold regression still passed. The plan is the actual
 * thing that changed: a sequential scan over attendance, or the scope's set
 * turning back into a per-row subquery. Asserting on it fails for the real
 * reason and does not fail for the wrong one.
 */
describe('attendance performance', () => {
  let owner: DataSource;
  let app: DataSource;

  const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const TEACHER_USER = '70000000-0000-4000-8000-000000000001';
  const ADMIN_USER = '70000000-0000-4000-8000-000000000002';

  const STUDENTS = 2_000;
  const CLASSES = 40;
  const DAYS = 60;

  let teacherMembership: string;
  let classId: string;

  /** Every node in an EXPLAIN plan, flattened. */
  interface PlanNode {
    'Node Type': string;
    'Relation Name'?: string;
    'Index Name'?: string;
    Plans?: PlanNode[];
  }

  function flatten(node: PlanNode): PlanNode[] {
    return [node, ...(node.Plans ?? []).flatMap(flatten)];
  }

  async function planFor(sql: string, parameters: unknown[]): Promise<PlanNode[]> {
    const rows = await app.query<Array<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>>(
      `EXPLAIN (FORMAT JSON) ${sql}`,
      parameters,
    );

    return flatten(rows[0]['QUERY PLAN'][0].Plan);
  }

  beforeAll(async () => {
    owner = createTestDataSource();
    await owner.initialize();
    await resetSchema(owner);
    await owner.runMigrations({ transaction: 'all' });
    await owner.query(`ALTER ROLE cyberschola_app WITH PASSWORD '${APP_ROLE_PASSWORD}'`);

    const url = new URL(integrationDatabaseUrl());
    url.username = 'cyberschola_app';
    url.password = APP_ROLE_PASSWORD;
    app = new DataSource({
      type: 'postgres',
      url: url.toString(),
      ssl: false,
      synchronize: false,
      logging: ['error'],
      entities: ['src/**/*.entity.ts'],
    });
    await app.initialize();

    await owner.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Greenfield', 'greenfield')`,
      [SCHOOL],
    );

    const admin = await seedMember(owner, SCHOOL, ADMIN_USER, [Role.SchoolAdmin]);
    const teacher = await seedMember(owner, SCHOOL, TEACHER_USER, [Role.Teacher]);
    teacherMembership = teacher.membershipId;

    const year = await seedAcademicYear(owner, SCHOOL);

    // Forty classes of fifty, rather than one class of two thousand. The shape
    // matters as much as the size: with every child in one class, `class_id`
    // selects every row in the school and no index on it could earn its place,
    // so a plan assertion would be asserting something untrue of a real school.
    const classIds: string[] = [];

    for (let index = 0; index < CLASSES; index++) {
      const seeded = await seedClass(owner, SCHOOL, year, {
        arm: `C${index}`,
        // The teacher supervises the first one, and only that one.
        supervisorTeacherId: index === 0 ? teacher.roleRows[Role.Teacher] : undefined,
      });

      classIds.push(seeded.classId);
    }

    classId = classIds[0]!;

    // Two thousand children, enrolled, in bulk. Row by row through the fixtures
    // would take longer than the rest of the suite put together.
    await owner.query(
      `INSERT INTO students (tenant_id, first_name, last_name)
       SELECT $1, 'Pupil', n::text FROM generate_series(1, $2) AS n`,
      [SCHOOL, STUDENTS],
    );
    await owner.query(
      `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id)
       SELECT $1, ($3::uuid[])[(pupil.position % $4) + 1], $2, pupil.id
         FROM (
           SELECT student.id, (row_number() OVER (ORDER BY student.id))::int - 1 AS position
             FROM students student
            WHERE student.tenant_id = $1 AND student.first_name = 'Pupil'
         ) pupil`,
      [SCHOOL, year.sessionId, classIds, CLASSES],
    );

    // Sixty school days for each of them: 120,000 rows.
    await owner.query(
      `INSERT INTO attendance
         (tenant_id, attendance_type, date, status, marked_by,
          student_id, enrolment_id, class_id, session_id, term_id)
       SELECT $1, 'STUDENT', day::date, 'PRESENT', $2,
              enrolment.student_id, enrolment.id, enrolment.class_id, enrolment.session_id, $3
         FROM class_enrolments enrolment,
              generate_series('2026-09-01'::date, '2026-09-01'::date + ($4 - 1), '1 day') AS day
        WHERE enrolment.tenant_id = $1`,
      [SCHOOL, admin.membershipId, year.termId, DAYS],
    );

    // Without this the planner is working from an empty table's statistics, and
    // the plan asserted below would be a plan for a table that no longer exists.
    await owner.query('ANALYZE attendance');
  }, 300_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  it('seeded a school large enough for the assertions below to mean something', async () => {
    const [row] = await owner.query<Array<{ count: string }>>(
      `SELECT count(*) AS count FROM attendance WHERE tenant_id = $1`,
      [SCHOOL],
    );

    expect(Number(row.count)).toBe(STUDENTS * DAYS);

    const [enrolled] = await owner.query<Array<{ count: string }>>(
      `SELECT count(*) AS count FROM class_enrolments WHERE tenant_id = $1 AND class_id = $2`,
      [SCHOOL, classId],
    );

    // A class, not a school: the register query has to be selective for the
    // index assertion below to be about anything.
    expect(Number(enrolled.count)).toBe(STUDENTS / CLASSES);
  });

  it("does not scan the whole table for a teacher's first page", async () => {
    const roles = await app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_user', $1, true)`, [TEACHER_USER]);

      return rolesOfMembership(manager, SCHOOL, teacherMembership);
    });

    const [sql, parameters] = runWithRequestContext(
      { origin: 'http', tenantId: SCHOOL, userId: TEACHER_USER, roles, requestId: 'plan' },
      () =>
        new ReadAttendanceAction(app.manager)
          .listQuery({}, { limit: 25, offset: 0 })
          .getQueryAndParameters(),
    );

    const nodes = await planFor(sql, parameters);
    const scanned = nodes.filter(
      (node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'attendance',
    );

    expect(scanned).toHaveLength(0);
  });

  it("answers a day's register from the class index rather than by scanning", async () => {
    const roles = await app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_user', $1, true)`, [ADMIN_USER]);

      return rolesOfMembership(manager, SCHOOL, teacherMembership);
    });

    const [sql, parameters] = runWithRequestContext(
      {
        origin: 'http',
        tenantId: SCHOOL,
        userId: ADMIN_USER,
        roles: [...roles, Role.SchoolAdmin],
        requestId: 'plan',
      },
      () =>
        new ReadAttendanceAction(app.manager)
          .listQuery({ classId, date: '2026-09-15' }, { limit: 100, offset: 0 })
          .getQueryAndParameters(),
    );

    const nodes = await planFor(sql, parameters);

    expect(nodes.map((node) => node['Index Name']).filter(Boolean)).toContain(
      'attendance_class_day_idx',
    );
  });

  it('keeps the teacher rule as one set rather than a subquery per row', async () => {
    const roles = await app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_user', $1, true)`, [TEACHER_USER]);

      return rolesOfMembership(manager, SCHOOL, teacherMembership);
    });

    const [sql] = runWithRequestContext(
      { origin: 'http', tenantId: SCHOOL, userId: TEACHER_USER, roles, requestId: 'plan' },
      () =>
        new ReadAttendanceAction(app.manager)
          .listQuery({}, { limit: 25, offset: 0 })
          .getQueryAndParameters(),
    );

    // The shape is the guarantee: a set of student ids tested with IN, which
    // Postgres evaluates once and hashes. An EXISTS correlated with the outer
    // row is what took 1.46 seconds in BE-P01, and it would read just as well.
    expect(sql).toContain('IN (');
    expect(sql).not.toMatch(/EXISTS\s*\(/i);
  });
});
