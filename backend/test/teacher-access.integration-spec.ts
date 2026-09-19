import { DataSource } from 'typeorm';

import { ListStudentsAction } from '../src/people/list-students.action';
import { Role } from '../src/auth/permission.matrix';
import { runWithRequestContext } from '../src/tenancy/request-context';
import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';
import { seedMember } from './people.fixtures';

/**
 * The teacher access rule, proven by what each teacher actually gets back.
 *
 * Blueprint sections 13 and 14: a teacher may reach a student if they supervise
 * the student's class, or teach a subject that student takes. A rule with three
 * branches is mostly wrong at its edges, so this suite is built around the near
 * misses, each one a realistic way the query goes wrong while the obvious cases
 * still pass.
 *
 * Runs as `cyberschola_app`, so row-level security is live underneath the scope.
 * A suite running as the owner would prove the SQL and nothing about the
 * boundary.
 */
describe('teacher access to students', () => {
  let owner: DataSource;
  let app: DataSource;

  const APP_PASSWORD = 'app_role_local_only';

  const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const OTHER_SCHOOL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  /**
   * People, by the Supabase subject they sign in as. A readable name maps to a
   * deterministic uuid so a failure names the person rather than a hex string.
   */
  const people = [
    'admin',
    'supervisor',
    'coreTeacher',
    'electiveTeacher',
    'lastYearSupervisor',
    'lastYearCoreTeacher',
    'lastYearElectiveTeacher',
    'otherArmTeacher',
    'removedSupervisor',
    'unassignedTeacher',
    'suspendedTeacher',
    'otherSchoolTeacher',
    'studentA',
    'studentB',
    'scienceStudent',
    'artsStudent',
    'crossRegisteredStudent',
    'unenrolledStudent',
    'lastYearStudent',
    'otherSchoolStudent',
  ] as const;
  type Person = (typeof people)[number];

  const userId = (person: Person): string =>
    `${(people.indexOf(person) + 1).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

  /** The students table id for each student, filled during seeding. */
  const studentRow = new Map<Person, string>();

  beforeAll(async () => {
    owner = createTestDataSource();
    await owner.initialize();
    await resetSchema(owner);
    await owner.runMigrations({ transaction: 'all' });
    await owner.query(`ALTER ROLE cyberschola_app WITH PASSWORD '${APP_PASSWORD}'`);

    const url = new URL(integrationDatabaseUrl());
    url.username = 'cyberschola_app';
    url.password = APP_PASSWORD;
    app = new DataSource({
      type: 'postgres',
      url: url.toString(),
      ssl: false,
      synchronize: false,
      logging: ['error'],
      entities: ['src/**/*.entity.ts'],
    });
    await app.initialize();

    await seed();
  }, 120_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  /** Inserts one row as the owner and returns its id. */
  async function insert(table: string, values: Record<string, unknown>): Promise<string> {
    const columns = Object.keys(values);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const [row] = await owner.query<Array<{ id: string }>>(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
      Object.values(values),
    );

    return row.id;
  }

  async function seed(): Promise<void> {
    await owner.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Greenfield', 'greenfield'), ($2, 'Brookvale', 'brookvale')`,
      [SCHOOL, OTHER_SCHOOL],
    );

    const inSchool = (person: Person) => (person.startsWith('otherSchool') ? OTHER_SCHOOL : SCHOOL);

    const role = (person: Person): Role => {
      if (person === 'admin') return Role.SchoolAdmin;
      return person.toLowerCase().includes('student') ? Role.Student : Role.Teacher;
    };

    const teacherRow = new Map<Person, string>();

    for (const person of people) {
      // The role is the role row, not a column on the membership.
      const { roleRows } = await seedMember(
        owner,
        inSchool(person),
        userId(person),
        [role(person)],
        {
          status: person === 'suspendedTeacher' ? 'SUSPENDED' : 'ACTIVE',
        },
      );

      if (role(person) === Role.Teacher) {
        teacherRow.set(person, roleRows[Role.Teacher]!);
      } else if (role(person) === Role.Student) {
        studentRow.set(person, roleRows[Role.Student]!);
      }
    }

    const lastYear = await insert('academic_sessions', {
      tenant_id: SCHOOL,
      name: '2025/2026',
      starts_on: '2025-09-01',
      ends_on: '2026-07-31',
      is_current: false,
    });
    const thisYear = await insert('academic_sessions', {
      tenant_id: SCHOOL,
      name: '2026/2027',
      starts_on: '2026-09-01',
      ends_on: '2027-07-31',
      is_current: true,
    });
    const otherSchoolYear = await insert('academic_sessions', {
      tenant_id: OTHER_SCHOOL,
      name: '2026/2027',
      starts_on: '2026-09-01',
      ends_on: '2027-07-31',
      is_current: true,
    });

    const jss2 = await insert('grade_levels', { tenant_id: SCHOOL, name: 'JSS 2', position: 8 });
    const ss2 = await insert('grade_levels', { tenant_id: SCHOOL, name: 'SS 2', position: 11 });
    const otherGrade = await insert('grade_levels', {
      tenant_id: OTHER_SCHOOL,
      name: 'JSS 2',
      position: 8,
    });

    const classOf = (session: string, grade: string, arm: string, tenant = SCHOOL) =>
      insert('classes', { tenant_id: tenant, session_id: session, grade_level_id: grade, arm });

    const jss2a = await classOf(thisYear, jss2, 'A');
    const jss2b = await classOf(thisYear, jss2, 'B');
    const ss2a = await classOf(thisYear, ss2, 'A');
    const jss2aLastYear = await classOf(lastYear, jss2, 'A');
    const otherSchoolClass = await classOf(otherSchoolYear, otherGrade, 'A', OTHER_SCHOOL);

    const maths = await insert('subjects', { tenant_id: SCHOOL, name: 'Mathematics' });
    const physics = await insert('subjects', { tenant_id: SCHOOL, name: 'Physics' });

    const supervise = (person: Person, classId: string, extra: Record<string, unknown> = {}) =>
      insert('class_supervisors', {
        tenant_id: inSchool(person),
        class_id: classId,
        teacher_id: teacherRow.get(person),
        ...extra,
      });

    await supervise('supervisor', jss2a);
    await supervise('lastYearSupervisor', jss2aLastYear);
    await supervise('removedSupervisor', jss2a, { deleted_at: new Date() });
    await supervise('suspendedTeacher', jss2a);
    await supervise('otherSchoolTeacher', otherSchoolClass);

    const teach = (person: Person, classId: string, subjectId: string, isElective: boolean) =>
      insert('class_subjects', {
        tenant_id: SCHOOL,
        class_id: classId,
        subject_id: subjectId,
        teacher_id: teacherRow.get(person),
        is_elective: isElective,
      });

    await teach('coreTeacher', jss2a, maths, false);
    await teach('otherArmTeacher', jss2b, maths, false);
    const ss2aPhysics = await teach('electiveTeacher', ss2a, physics, true);
    // Last session's teaching, one per branch of the rule. Each must be cut off
    // by the current-session filter on its own, so un-sharing that filter later
    // cannot quietly reopen any single branch.
    await teach('lastYearCoreTeacher', jss2aLastYear, maths, false);
    const lastYearElective = await teach('lastYearElectiveTeacher', jss2aLastYear, physics, true);

    const enrol = (
      person: Person,
      classId: string,
      sessionId: string,
      extra: Record<string, unknown> = {},
    ) =>
      insert('class_enrolments', {
        tenant_id: inSchool(person),
        class_id: classId,
        session_id: sessionId,
        student_id: studentRow.get(person),
        ...extra,
      });

    await enrol('studentA', jss2a, thisYear);
    await enrol('studentB', jss2b, thisYear);
    await enrol('scienceStudent', ss2a, thisYear);
    await enrol('artsStudent', ss2a, thisYear);
    await enrol('crossRegisteredStudent', jss2b, thisYear);
    await enrol('unenrolledStudent', jss2a, thisYear, { deleted_at: new Date() });
    await enrol('lastYearStudent', jss2aLastYear, lastYear);
    await enrol('otherSchoolStudent', otherSchoolClass, otherSchoolYear);

    const register = (person: Person, classSubjectId: string) =>
      insert('elective_registrations', {
        tenant_id: SCHOOL,
        class_subject_id: classSubjectId,
        student_id: studentRow.get(person),
      });

    await register('scienceStudent', ss2aPhysics);
    await register('lastYearStudent', lastYearElective);
    // Registered for an elective taught in SS2A while enrolled in JSS2B. The
    // foreign keys allow it, both rows being in the same school, and the scope
    // must still refuse to treat it as taking that subject.
    await register('crossRegisteredStudent', ss2aPhysics);
  }

  /** Who a person can see, as names, sorted for a stable comparison. */
  async function visibleTo(person: Person, role: Role, tenantId = SCHOOL): Promise<Person[]> {
    const page = await runWithRequestContext(
      { origin: 'http', tenantId, userId: userId(person), roles: [role], requestId: 'test' },
      () =>
        app.transaction(async (manager) => {
          await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId(person)]);
          await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

          return new ListStudentsAction(manager).execute({ limit: 100, offset: 0 });
        }),
    );

    const byRow = new Map([...studentRow].map(([name, id]) => [id, name]));

    return page.items.map(({ student }) => byRow.get(student.id)!).sort();
  }

  describe('each way a teacher reaches a student', () => {
    it('reaches students in a class they supervise', async () => {
      expect(await visibleTo('supervisor', Role.Teacher)).toEqual(['studentA']);
    });

    it('reaches students in a class where they teach a core subject', async () => {
      expect(await visibleTo('coreTeacher', Role.Teacher)).toEqual(['studentA']);
    });

    it('reaches only the students registered for an elective they teach', async () => {
      // The Physics teacher in SS2A sees the science student and not the arts
      // student sitting in the same class, which is the whole reason electives
      // need registration rather than being taken by the class.
      expect(await visibleTo('electiveTeacher', Role.Teacher)).toEqual(['scienceStudent']);
    });
  });

  describe('near misses that must not grant access', () => {
    it('does not treat an unregistered student in the same class as taking the elective', async () => {
      expect(await visibleTo('electiveTeacher', Role.Teacher)).not.toContain('artsStudent');
    });

    it('does not honour an elective registration from a different class', async () => {
      // Registered for SS2A Physics while enrolled in JSS2B. The registration row
      // is real and in the right school; what it lacks is the student being in
      // that subject's class, and the scope checks both.
      expect(await visibleTo('electiveTeacher', Role.Teacher)).not.toContain(
        'crossRegisteredStudent',
      );
    });

    describe('last session, cut off by the current-session filter', () => {
      // Without that filter a teacher would keep every student they ever taught,
      // indefinitely. One case per branch of the rule, so each branch is guarded
      // on its own: dropping the filter from any single branch turns one of these
      // red, rather than relying on the branches happening to share a fragment.

      it("does not carry last session's supervision into this session", async () => {
        expect(await visibleTo('lastYearSupervisor', Role.Teacher)).toEqual([]);
      });

      it("does not carry last session's core subject into this session", async () => {
        expect(await visibleTo('lastYearCoreTeacher', Role.Teacher)).toEqual([]);
      });

      it("does not carry last session's elective into this session", async () => {
        // The student was even registered for it, so only the session keeps this
        // teacher out.
        expect(await visibleTo('lastYearElectiveTeacher', Role.Teacher)).toEqual([]);
      });
    });

    it('does not reach a student who was only in the class last session', async () => {
      // Guarded by classes belonging to a session rather than by the filter:
      // last year's JSS2A is a different row from this year's, and this teacher
      // supervises only this year's. Kept because it pins that property, but the
      // three tests above are what guard the filter itself. Removing the filter
      // leaves this one green, which was checked.
      expect(await visibleTo('supervisor', Role.Teacher)).not.toContain('lastYearStudent');
    });

    it('does not cross arms: the same subject in JSS2B does not reach JSS2A', async () => {
      const seen = await visibleTo('otherArmTeacher', Role.Teacher);

      expect(seen).not.toContain('studentA');
      expect(seen).toEqual(['crossRegisteredStudent', 'studentB']);
    });

    it('ignores a soft-deleted supervision', async () => {
      expect(await visibleTo('removedSupervisor', Role.Teacher)).toEqual([]);
    });

    it('ignores a soft-deleted enrolment', async () => {
      // The supervisor still supervises JSS2A, but this student's enrolment in it
      // was removed, so they are no longer in the class.
      expect(await visibleTo('supervisor', Role.Teacher)).not.toContain('unenrolledStudent');
    });

    it('grants nothing to a teacher with no assignments', async () => {
      expect(await visibleTo('unassignedTeacher', Role.Teacher)).toEqual([]);
    });

    it('grants nothing through a suspended membership', async () => {
      // A suspended teacher cannot resolve a tenant on the request path at all.
      // The rule checks status itself anyway, so it does not depend on that
      // having happened first, which matters for background jobs.
      expect(await visibleTo('suspendedTeacher', Role.Teacher)).toEqual([]);
    });
  });

  describe('the tenant boundary underneath', () => {
    it('shows a teacher nothing from another school, even acting in that school', async () => {
      // Acting with the other school's tenant set, this teacher holds no
      // assignments there, and row-level security hides everything of ours.
      expect(await visibleTo('supervisor', Role.Teacher, OTHER_SCHOOL)).toEqual([]);
    });

    it("lets the other school's teacher see only their own student", async () => {
      expect(await visibleTo('otherSchoolTeacher', Role.Teacher, OTHER_SCHOOL)).toEqual([
        'otherSchoolStudent',
      ]);
    });
  });

  describe('roles', () => {
    it('lets a school administrator see every student in the school', async () => {
      expect(await visibleTo('admin', Role.SchoolAdmin)).toEqual(
        [
          'artsStudent',
          'crossRegisteredStudent',
          'lastYearStudent',
          'scienceStudent',
          'studentA',
          'studentB',
          'unenrolledStudent',
        ].sort(),
      );
    });

    it('lets a student see themselves and nobody else', async () => {
      // Blueprint section 16. A student holds no supervision or subject
      // assignment, so the teacher branch cannot match; the self branch can,
      // and only for their own record.
      expect(await visibleTo('studentA', Role.Student)).toEqual(['studentA']);
    });

    it('fails closed for staff, whose role declares no branch', async () => {
      // The permission matrix keeps staff off the student routes. This is what
      // happens if that ever changes: FALSE, not the whole school.
      expect(await visibleTo('supervisor', Role.Staff)).toEqual([]);
    });
  });

  describe('the total follows the scope', () => {
    it('counts only what the teacher may see, not the school', async () => {
      const page = await runWithRequestContext(
        {
          origin: 'http',
          tenantId: SCHOOL,
          userId: userId('supervisor'),
          roles: [Role.Teacher],
          requestId: 'test',
        },
        () =>
          app.transaction(async (manager) => {
            await manager.query(`SELECT set_config('app.current_user', $1, true)`, [
              userId('supervisor'),
            ]);
            await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [SCHOOL]);

            return new ListStudentsAction(manager).execute({ limit: 100, offset: 0 });
          }),
      );

      // Seven students in the school; this teacher may see one.
      expect(page.total).toBe(1);
    });
  });
});
