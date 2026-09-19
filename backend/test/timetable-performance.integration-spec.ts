import { appendFileSync } from 'node:fs';

import { DataSource, type EntityManager, type SelectQueryBuilder } from 'typeorm';

import { Role } from '../src/auth/permission.matrix';
import { rolesOfMembership } from '../src/tenancy/membership-roles';
import { runWithRequestContext } from '../src/tenancy/request-context';
import type { TimetableLesson } from '../src/timetable/entities/timetable-lesson.entity';
import { myTimetableScope } from '../src/timetable/my-timetable.scope';
import { ReadTimetableAction } from '../src/timetable/read-timetable.action';
import { CONFLICTS_SQL } from '../src/timetable/timetable.service';
import { APP_ROLE_PASSWORD } from './app-database.env';
import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';
import { seedMember } from './people.fixtures';

/**
 * The timetable's reads, on a school with five years of timetables behind it.
 *
 * A timetable is small in any one week: forty classes of fifty lessons is two
 * thousand rows. What grows is history. Lessons are kept per session, so a school
 * five years in holds ten thousand, and a read that scans them all gets slower
 * every September without anyone changing a line. So the seed is five sessions,
 * and the question every test asks is whether a read touches this year's rows or
 * everyone's.
 *
 * Asserted on the plan, not the clock, for the reason recorded in the attendance
 * performance suite: the plan is what changes when the code regresses, and a
 * stopwatch goes red on a busy runner for reasons that are not the code.
 *
 * The first run of this suite changed the code twice. A caller's own week read
 * every lesson of every year to return this year's fifty: the planner cannot
 * size the caller's own set, so it started from every class the school has ever
 * had. Stating on the joins that a lesson's class and period share its session,
 * which the foreign keys already guarantee, lets the session filter reach the
 * classes too. And the conflicts report scanned every year's lessons, having no
 * index to start from; `timetable_lessons_session_live_idx` is that index. The
 * class and teacher weeks needed nothing: the clash rules' own indexes serve them.
 *
 * So the assertion is the property rather than an index name: no read examines
 * more than one session's lessons, however many years the school has.
 *
 * Every test also requires its read to return rows. A plan for a query that
 * matches nothing proves nothing about scanning, and one of these once did.
 */
describe('timetable performance', () => {
  let owner: DataSource;
  let app: DataSource;

  const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ADMIN_USER = '71000000-0000-4000-8000-000000000001';
  const PUPIL_USER = '71000000-0000-4000-8000-000000000002';
  const PARENT_USER = '71000000-0000-4000-8000-000000000003';
  const TEACHER_USER = '71000000-0000-4000-8000-000000000004';

  const SESSIONS = 5;
  const CLASSES = 40;
  const SUBJECTS = 10;
  /** The last two subjects of every class are electives, run side by side. */
  const ELECTIVES = 2;
  const PUPILS = 2_000;
  /** Five days of nine periods: eight core, then the options block. */
  const DAYS = 5;
  const SLOTS = 9;
  /** One session's lessons: what no read may examine more of. */
  const SESSION_LESSONS = CLASSES * DAYS * (SLOTS - 1 + ELECTIVES);

  let currentSession: string;
  let classId: string;
  let teacherId: string;
  const memberships: Record<string, string> = {};

  interface PlanNode {
    'Node Type': string;
    'Actual Rows'?: number;
    'Actual Loops'?: number;
    'Rows Removed by Filter'?: number;
    'Rows Removed by Index Recheck'?: number;
    'Relation Name'?: string;
    'Index Name'?: string;
    Plans?: PlanNode[];
  }

  const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];

  /** Reads lessons are drawn from, and how, for the evidence and the assertions. */
  const lessonAccess = (nodes: PlanNode[]) =>
    nodes
      .filter(
        (node) =>
          node['Relation Name'] === 'timetable_lessons' ||
          node['Index Name']?.startsWith('timetable_lessons'),
      )
      .map((node) => `${node['Node Type']}${node['Index Name'] ? ` ${node['Index Name']}` : ''}`);

  /**
   * How many lesson rows a plan looked at: every row a scan of the table
   * produced or threw away, across every loop. The property the suite exists to
   * hold is that this stays within one session's lessons however many years the
   * school has, which a plan can meet with or without any particular index.
   */
  const lessonsExamined = (nodes: PlanNode[]) =>
    nodes
      .filter((node) => node['Relation Name'] === 'timetable_lessons')
      .reduce(
        (total, node) =>
          total +
          ((node['Actual Rows'] ?? 0) +
            (node['Rows Removed by Filter'] ?? 0) +
            (node['Rows Removed by Index Recheck'] ?? 0)) *
            (node['Actual Loops'] ?? 1),
        0,
      );

  const seqScans = (nodes: PlanNode[], relation: string) =>
    nodes.filter((node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === relation);

  async function rolesOf(userId: string): Promise<string[]> {
    return userId === ADMIN_USER
      ? [Role.SchoolAdmin]
      : app.transaction(async (manager) => {
          await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);

          return rolesOfMembership(manager, SCHOOL, memberships[userId]);
        });
  }

  /**
   * EXPLAIN ANALYZE of a statement as a caller, inside their tenant context.
   *
   * Timings are recorded for the pull request's evidence when
   * TIMETABLE_TIMINGS_FILE is set, and never asserted.
   */
  async function explain(
    label: string,
    userId: string,
    build: (manager: EntityManager) => [string, unknown[]],
  ): Promise<PlanNode[]> {
    const roles = await rolesOf(userId);

    return runWithRequestContext(
      { origin: 'http', tenantId: SCHOOL, userId, roles, requestId: 'timetable-plan' },
      () =>
        app.transaction(async (manager) => {
          await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
          await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [SCHOOL]);

          const [sql, parameters] = build(manager);
          const [row] = await manager.query<
            Array<{ 'QUERY PLAN': Array<{ Plan: PlanNode; 'Execution Time': number }> }>
          >(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, parameters);
          const explained = row['QUERY PLAN'][0];
          const nodes = flatten(explained.Plan);

          if (process.env.TIMETABLE_PLANS_FILE) {
            const text = await manager.query<Array<{ 'QUERY PLAN': string }>>(
              `EXPLAIN (ANALYZE, COSTS OFF) ${sql}`,
              parameters,
            );
            appendFileSync(
              process.env.TIMETABLE_PLANS_FILE,
              `=== ${label}\n${text.map((line) => line['QUERY PLAN']).join('\n')}\n\n`,
            );
          }

          if (process.env.TIMETABLE_TIMINGS_FILE) {
            appendFileSync(
              process.env.TIMETABLE_TIMINGS_FILE,
              `${label.padEnd(34)} ${explained['Execution Time'].toFixed(1).padStart(6)} ms ` +
                `${String(lessonsExamined(nodes)).padStart(6)} examined   ` +
                `${lessonAccess(nodes).join(', ')}\n`,
            );
          }

          return nodes;
        }),
    );
  }

  type Filter = (query: SelectQueryBuilder<TimetableLesson>) => void;

  /** The statement a week read runs, exactly as the service would build it. */
  const weekOf = (manager: EntityManager, filter: Filter, scoped = false) =>
    new ReadTimetableAction(manager, scoped ? myTimetableScope() : undefined)
      .lessonsQuery(filter)
      .getQueryAndParameters() as [string, unknown[]];

  const thisSession: Filter = (query) =>
    query.andWhere('lesson.sessionId = :sessionId', { sessionId: currentSession });

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
    await seedMember(owner, SCHOOL, ADMIN_USER, [Role.SchoolAdmin]);

    // Five sessions, the last one current.
    await owner.query(
      `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
       SELECT $1, (2021 + n) || '/' || (2022 + n),
              make_date(2021 + n, 9, 1), make_date(2022 + n, 7, 31), n = $2
         FROM generate_series(1, $2) AS n`,
      [SCHOOL, SESSIONS],
    );
    [{ id: currentSession }] = await owner.query<Array<{ id: string }>>(
      `SELECT id FROM academic_sessions WHERE tenant_id = $1 AND is_current`,
      [SCHOOL],
    );

    // Five grades of eight arms: forty classes a session.
    await owner.query(
      `INSERT INTO grade_levels (tenant_id, name, position)
       SELECT $1, 'Grade ' || g, g FROM generate_series(1, 5) AS g`,
      [SCHOOL],
    );
    await owner.query(
      `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm)
       SELECT $1, session.id, grade.id, chr(64 + arm)
         FROM academic_sessions session, grade_levels grade, generate_series(1, 8) AS arm
        WHERE session.tenant_id = $1 AND grade.tenant_id = $1`,
      [SCHOOL],
    );
    await owner.query(
      `INSERT INTO subjects (tenant_id, name)
       SELECT $1, 'Subject ' || k FROM generate_series(0, $2 - 1) AS k`,
      [SCHOOL, SUBJECTS],
    );

    // One teacher per class and subject position, reused every year, so no two
    // lessons in a period ever share a teacher. Numbered for the joins below.
    await owner.query(
      `INSERT INTO teachers (tenant_id, first_name, last_name)
       SELECT $1, 'Teacher', lpad(n::text, 3, '0') FROM generate_series(0, $2 - 1) AS n`,
      [SCHOOL, CLASSES * SUBJECTS],
    );

    // Each session's classes numbered 0 to 39, subjects 0 to 9.
    await owner.query(`
      CREATE TEMP TABLE numbered_classes AS
        SELECT class.id, class.session_id,
               (row_number() OVER (PARTITION BY class.session_id
                                   ORDER BY grade.position, class.arm))::int - 1 AS n
          FROM classes class JOIN grade_levels grade ON grade.id = class.grade_level_id
    `);
    await owner.query(`
      CREATE TEMP TABLE numbered_subjects AS
        SELECT id, (row_number() OVER (ORDER BY name))::int - 1 AS n FROM subjects
    `);
    await owner.query(`
      CREATE TEMP TABLE numbered_teachers AS
        SELECT id, last_name::int AS n FROM teachers WHERE first_name = 'Teacher'
    `);

    await owner.query(
      `INSERT INTO class_subjects (tenant_id, class_id, subject_id, teacher_id, is_elective)
       SELECT $1, class.id, subject.id, teacher.id, subject.n >= $2
         FROM numbered_classes class
         CROSS JOIN numbered_subjects subject
         JOIN numbered_teachers teacher ON teacher.n = class.n * $3 + subject.n`,
      [SCHOOL, SUBJECTS - ELECTIVES, SUBJECTS],
    );

    // Forty-five periods a week per session, forty minutes each from 08:00.
    await owner.query(
      `INSERT INTO timetable_periods (tenant_id, session_id, weekday, label, starts_at, ends_at)
       SELECT $1, session.id, day, 'P' || (slot + 1),
              time '08:00' + slot * interval '40 minutes',
              time '08:40' + slot * interval '40 minutes'
         FROM academic_sessions session, generate_series(1, $2) AS day,
              generate_series(0, $3 - 1) AS slot`,
      [SCHOOL, DAYS, SLOTS],
    );

    // Slots one to eight: a core subject, rotated by class and day. Slot nine:
    // both electives side by side. Fifty lessons per class per week.
    await owner.query(
      `INSERT INTO timetable_lessons
         (tenant_id, session_id, period_id, class_id, class_subject_id, teacher_id, is_elective)
       SELECT $1, period.session_id, period.id, assignment.class_id, assignment.id,
              assignment.teacher_id, assignment.is_elective
         FROM timetable_periods period
         JOIN numbered_classes class ON class.session_id = period.session_id
         JOIN class_subjects assignment ON assignment.class_id = class.id
         JOIN numbered_subjects subject ON subject.id = assignment.subject_id
        WHERE CASE
                WHEN period.starts_at = time '08:00' + ($3 - 1) * interval '40 minutes'
                  THEN assignment.is_elective
                ELSE NOT assignment.is_elective
                 AND subject.n = (extract(epoch FROM period.starts_at - time '08:00') / 2400
                                  + class.n + period.weekday)::int % $2
              END`,
      [SCHOOL, SUBJECTS - ELECTIVES, SLOTS],
    );

    // Two thousand pupils, enrolled every year, fifty to a class.
    await owner.query(
      `INSERT INTO students (tenant_id, first_name, last_name)
       SELECT $1, 'Pupil', lpad(n::text, 4, '0') FROM generate_series(0, $2 - 1) AS n`,
      [SCHOOL, PUPILS],
    );
    await owner.query(
      `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id)
       SELECT $1, class.id, class.session_id, student.id
         FROM students student
         JOIN numbered_classes class ON class.n = student.last_name::int % $2
        WHERE student.first_name = 'Pupil'`,
      [SCHOOL, CLASSES],
    );

    // This year each pupil takes one of their class's electives, and one in
    // twenty takes both: a hundred conflicts for the report to find.
    await owner.query(
      `INSERT INTO elective_registrations (tenant_id, class_subject_id, student_id)
       SELECT $1, assignment.id, enrolment.student_id
         FROM class_enrolments enrolment
         JOIN students student ON student.id = enrolment.student_id
         JOIN class_subjects assignment
           ON assignment.class_id = enrolment.class_id AND assignment.is_elective
         JOIN numbered_subjects subject ON subject.id = assignment.subject_id
        WHERE enrolment.session_id = $2
          AND (student.last_name::int % 20 = 0
               OR subject.n % 2 = student.last_name::int % 2)`,
      [SCHOOL, currentSession],
    );

    // Logins for the callers whose own week is measured: pupil 0000, a parent of
    // pupils 0000 and 0041 (different classes), and the teacher of class 0's
    // first subject.
    const pupil = await seedMember(owner, SCHOOL, PUPIL_USER, []);
    const parent = await seedMember(owner, SCHOOL, PARENT_USER, [Role.Parent]);
    const teacher = await seedMember(owner, SCHOOL, TEACHER_USER, []);
    memberships[PUPIL_USER] = pupil.membershipId;
    memberships[PARENT_USER] = parent.membershipId;
    memberships[TEACHER_USER] = teacher.membershipId;

    await owner.query(
      `UPDATE students SET membership_id = $1 WHERE last_name = '0000' AND first_name = 'Pupil'`,
      [pupil.membershipId],
    );
    await owner.query(`UPDATE teachers SET membership_id = $1 WHERE last_name = '000'`, [
      teacher.membershipId,
    ]);
    // Read back separately: an UPDATE ... RETURNING through TypeORM resolves to
    // [rows, count], which destructured as rows once left this undefined and
    // made the teacher's plan a query for nothing.
    [{ id: teacherId }] = await owner.query<Array<{ id: string }>>(
      `SELECT id FROM teachers WHERE membership_id = $1`,
      [teacher.membershipId],
    );
    await owner.query(
      `INSERT INTO guardianships (tenant_id, parent_id, student_id)
       SELECT $1, $2, id FROM students WHERE first_name = 'Pupil' AND last_name IN ('0000', '0041')`,
      [SCHOOL, parent.roleRows[Role.Parent]],
    );

    [{ id: classId }] = await owner.query<Array<{ id: string }>>(
      `SELECT id FROM numbered_classes WHERE session_id = $1 AND n = 0`,
      [currentSession],
    );

    for (const table of [
      'timetable_lessons',
      'timetable_periods',
      'class_subjects',
      'class_enrolments',
      'elective_registrations',
      'students',
      'teachers',
    ]) {
      await owner.query(`ANALYZE ${table}`);
    }
  }, 300_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  it('seeded five years of a forty-class school, so history outweighs any one week', async () => {
    const [row] = await owner.query<Array<{ total: string; current: string; conflicts: string }>>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE session_id = $1) AS current
         FROM timetable_lessons`,
      [currentSession],
    );

    expect(Number(row.current)).toBe(CLASSES * DAYS * (SLOTS - 1 + ELECTIVES));
    expect(Number(row.total)).toBe(Number(row.current) * SESSIONS);
  });

  it("reads a class's week from the class's own lessons, not the school's", async () => {
    const nodes = await explain('class week (administrator)', ADMIN_USER, (manager) =>
      weekOf(manager, (query) => query.andWhere('lesson.classId = :classId', { classId })),
    );

    expect(seqScans(nodes, 'timetable_lessons')).toHaveLength(0);
    expect(lessonsExamined(nodes)).toBeLessThanOrEqual(SESSION_LESSONS);
    expect(nodes[0]['Actual Rows']).toBe(DAYS * (SLOTS - 1 + ELECTIVES));
  });

  it("reads a teacher's week from the teacher's own lessons", async () => {
    const nodes = await explain('teacher week (administrator)', ADMIN_USER, (manager) =>
      weekOf(manager, (query) => {
        query.andWhere('lesson.teacherId = :teacherId', { teacherId });
        thisSession(query);
      }),
    );

    expect(seqScans(nodes, 'timetable_lessons')).toHaveLength(0);
    expect(lessonsExamined(nodes)).toBeLessThanOrEqual(SESSION_LESSONS);
    expect(nodes[0]['Actual Rows']).toBeGreaterThan(0);
  });

  it.each([
    ['my week as a pupil', PUPIL_USER],
    ['my week as a parent of two', PARENT_USER],
    ['my week as a teacher', TEACHER_USER],
  ])('answers %s without scanning every lesson', async (label, userId) => {
    const nodes = await explain(label, userId, (manager) => weekOf(manager, thisSession, true));

    expect(seqScans(nodes, 'timetable_lessons')).toHaveLength(0);
    expect(lessonsExamined(nodes)).toBeLessThanOrEqual(SESSION_LESSONS);
    expect(nodes[0]['Actual Rows']).toBeGreaterThan(0);
  });

  it('keeps each my-week rule as a set rather than a subquery per lesson', () => {
    const [sql] = runWithRequestContext(
      {
        origin: 'http',
        tenantId: SCHOOL,
        userId: PARENT_USER,
        roles: [Role.Student, Role.Parent, Role.Teacher],
        requestId: 'timetable-shape',
      },
      () => weekOf(app.manager, thisSession, true),
    );

    expect(sql).toContain('IN (');
    expect(sql).not.toMatch(/EXISTS\s*\(/i);
  });

  it("finds the conflicts from this session's lessons, not every year's", async () => {
    const nodes = await explain('conflicts report (administrator)', ADMIN_USER, () => [
      CONFLICTS_SQL,
      [SCHOOL, currentSession],
    ]);

    expect(seqScans(nodes, 'timetable_lessons')).toHaveLength(0);
    expect(lessonsExamined(nodes)).toBeLessThanOrEqual(SESSION_LESSONS);
    // One pupil in twenty registered for both electives of the options block,
    // which runs once a day.
    expect(nodes[0]['Actual Rows']).toBe((PUPILS / 20) * DAYS);
  });
});
