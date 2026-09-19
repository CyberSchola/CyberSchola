import { appendFileSync } from 'node:fs';

import { DataSource } from 'typeorm';

import { ReadAttendanceAction } from '../src/attendance/read-attendance.action';
import { ReportAttendanceAction } from '../src/attendance/report-attendance.action';
import { ReportGrouping, ReportPeriod } from '../src/attendance/report-period';
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
 * seeds a school year of registers, two terms of weekdays, about 300,000 rows,
 * and asserts on the query plan.
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
  /** The two terms seeded: every weekday in them is a school day. */
  const FIRST_TERM = ['2026-09-01', '2026-12-18'] as const;
  const SECOND_TERM = ['2027-01-05', '2027-04-09'] as const;

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

    // A school year of registers: every weekday of two terms, for every child.
    // Mostly present, with absences and lateness spread deterministically, so the
    // counts in a report are not all one status.
    const [secondTerm] = await owner.query<Array<{ id: string }>>(
      `INSERT INTO terms (tenant_id, session_id, name, starts_on, ends_on)
       VALUES ($1, $2, 'Second Term', $3, $4) RETURNING id`,
      [SCHOOL, year.sessionId, SECOND_TERM[0], SECOND_TERM[1]],
    );

    for (const [termId, [from, to]] of [
      [year.termId, FIRST_TERM],
      [secondTerm.id, SECOND_TERM],
    ] as const) {
      await owner.query(
        `INSERT INTO attendance
           (tenant_id, attendance_type, date, status, marked_by,
            student_id, enrolment_id, class_id, session_id, term_id)
         SELECT $1, 'STUDENT', day::date,
                (CASE abs(hashtext(enrolment.student_id::text || day::text)) % 20
                   WHEN 0 THEN 'ABSENT' WHEN 1 THEN 'LATE' WHEN 2 THEN 'SICK' ELSE 'PRESENT'
                 END)::attendance_status_enum,
                $2, enrolment.student_id, enrolment.id, enrolment.class_id, enrolment.session_id, $3
           FROM class_enrolments enrolment,
                generate_series($4::date, $5::date, '1 day') AS day
          WHERE enrolment.tenant_id = $1
            AND extract(isodow FROM day) < 6`,
        [SCHOOL, admin.membershipId, termId, from, to],
      );
    }

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

    const [days] = await owner.query<Array<{ count: string }>>(
      `SELECT count(*) AS count FROM (
         SELECT generate_series($1::date, $2::date, '1 day') AS day
         UNION ALL
         SELECT generate_series($3::date, $4::date, '1 day')
       ) days WHERE extract(isodow FROM day) < 6`,
      [...FIRST_TERM, ...SECOND_TERM],
    );

    // Every weekday of two terms for every child: a school year of registers.
    expect(Number(row.count)).toBe(STUDENTS * Number(days.count));
    expect(Number(row.count)).toBeGreaterThan(290_000);

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

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  describe('reports', () => {
    const GROUPINGS = [ReportGrouping.Class, ReportGrouping.Student, ReportGrouping.Role];

    /** The roles a caller holds, read from the database as the resolver reads them. */
    async function rolesOf(userId: string): Promise<string[]> {
      return userId === ADMIN_USER
        ? [Role.SchoolAdmin]
        : app.transaction(async (manager) => {
            await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);

            return rolesOfMembership(manager, SCHOOL, teacherMembership);
          });
    }

    /** The statement a report runs, and its plan and measured time, as the caller. */
    async function explainReport(userId: string, period: ReportPeriod, groupBy: ReportGrouping) {
      const roles = await rolesOf(userId);

      return runWithRequestContext(
        { origin: 'http', tenantId: SCHOOL, userId, roles, requestId: 'report-plan' },
        () =>
          app.transaction(async (manager) => {
            await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
            await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [SCHOOL]);

            const action = new ReportAttendanceAction(manager);
            const range = await action.resolvePeriod(period, '2026-10-14');
            const [sql, parameters] = action.reportQuery(range, groupBy).getQueryAndParameters();
            const [row] = await manager.query<
              Array<{ 'QUERY PLAN': Array<{ Plan: PlanNode; 'Execution Time': number }> }>
            >(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, parameters);
            const explained = row['QUERY PLAN'][0];
            const nodes = flatten(explained.Plan);

            // Timings are recorded for the pull request's evidence, never
            // asserted: wall-clock on a shared runner is not a property of the code.
            if (process.env.REPORT_TIMINGS_FILE) {
              const scans = nodes
                .filter((node) => node['Relation Name'] === 'attendance')
                .map((node) => node['Node Type'])
                .join(', ');
              appendFileSync(
                process.env.REPORT_TIMINGS_FILE,
                `${userId === ADMIN_USER ? 'administrator' : 'teacher      '}  ${period.padEnd(8)} ` +
                  `by ${groupBy.padEnd(8)} ${explained['Execution Time'].toFixed(1).padStart(7)} ms   ${scans}
`,
              );
            }

            return { sql, nodes };
          }),
      );
    }

    const scanned = (nodes: PlanNode[]) =>
      nodes.filter(
        (node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'attendance',
      );

    it.each(GROUPINGS)(
      "answers an administrator's weekly report by %s from an index",
      async (groupBy) => {
        const { nodes } = await explainReport(ADMIN_USER, ReportPeriod.Weekly, groupBy);

        expect(scanned(nodes)).toHaveLength(0);
      },
    );

    it.each(GROUPINGS)("answers a teacher's weekly report by %s from an index", async (groupBy) => {
      const { nodes } = await explainReport(TEACHER_USER, ReportPeriod.Weekly, groupBy);

      expect(scanned(nodes)).toHaveLength(0);
    });

    it.each(GROUPINGS)(
      'counts a whole session by %s without joining names onto every row',
      async (groupBy) => {
        // The regression this guards against was measured: joining student names
        // onto each of the year's rows before grouping took a whole-school session
        // report by student to over three seconds. The count now reads attendance
        // alone and the grouped rows are labelled afterwards. A session report
        // itself reads most of the school's year, so a sequential scan is the right
        // plan there and is deliberately not asserted against.
        const { sql } = await explainReport(ADMIN_USER, ReportPeriod.Session, groupBy);

        expect(sql).not.toMatch(/\bJOIN\b/i);
      },
    );

    it('records the teacher session timings too, for the evidence', async () => {
      for (const groupBy of GROUPINGS) {
        const { nodes } = await explainReport(TEACHER_USER, ReportPeriod.Session, groupBy);

        expect(nodes.length).toBeGreaterThan(0);
      }
    });
  });
});
