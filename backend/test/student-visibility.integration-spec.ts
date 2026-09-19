import { DataSource } from 'typeorm';

import { Role } from '../src/auth/permission.matrix';
import { ListStudentsAction } from '../src/people/list-students.action';
import { runWithRequestContext } from '../src/tenancy/request-context';
import { rolesOfMembership } from '../src/tenancy/membership-roles';
import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';
import { seedMember, seedRoleRow } from './people.fixtures';

/**
 * Who sees which student, and how much of each: every cell, stated.
 *
 * Blueprint sections 13, 14, 16, 17 and 18, and rules 9, 10 and 11. Asserted as a
 * table rather than sampled, the same way the permission matrix is, because the
 * cells nobody wrote a test for are where a leak hides, and with several roles per
 * person the dangerous cells are the combinations.
 *
 * Runs as `cyberschola_app` with the roles read from the real `membership_roles`
 * view, exactly as the resolver reads them, so a caller's roles here are what the
 * database says and not what the test asserts.
 */
describe('student visibility', () => {
  let owner: DataSource;
  let app: DataSource;

  const APP_PASSWORD = 'app_role_local_only';
  const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const OTHER_SCHOOL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  /** The people who ask. */
  const CALLERS = [
    'admin',
    'teacher',
    'parent',
    'student',
    'staff',
    'teacherParent',
    'otherSchoolAdmin',
  ] as const;
  type Caller = (typeof CALLERS)[number];

  /** The students asked about. */
  const TARGETS = [
    'pupil',
    'tpPupil',
    'child',
    'ownChild',
    'self',
    'unrelated',
    'otherSchool',
  ] as const;
  type Target = (typeof TARGETS)[number];

  type Cell = 'hidden' | 'summary' | 'profile';

  /**
   * The whole policy. Each row is one caller; each column one student.
   *
   * - pupil: in the class the teacher supervises.
   * - tpPupil: in the class the teacher-parent supervises.
   * - child: the parent's linked child.
   * - ownChild: the teacher-parent's linked child.
   * - self: the student caller's own record.
   * - unrelated: in the school, linked to nobody here.
   * - otherSchool: a student of another school.
   */
  const EXPECTED: Readonly<Record<Caller, Readonly<Record<Target, Cell>>>> = {
    admin: {
      pupil: 'profile',
      tpPupil: 'profile',
      child: 'profile',
      ownChild: 'profile',
      self: 'profile',
      unrelated: 'profile',
      otherSchool: 'hidden',
    },
    teacher: {
      pupil: 'summary',
      tpPupil: 'hidden',
      child: 'hidden',
      ownChild: 'hidden',
      self: 'hidden',
      unrelated: 'hidden',
      otherSchool: 'hidden',
    },
    parent: {
      pupil: 'hidden',
      tpPupil: 'hidden',
      child: 'profile',
      ownChild: 'hidden',
      self: 'hidden',
      unrelated: 'hidden',
      otherSchool: 'hidden',
    },
    student: {
      pupil: 'hidden',
      tpPupil: 'hidden',
      child: 'hidden',
      ownChild: 'hidden',
      self: 'profile',
      unrelated: 'hidden',
      otherSchool: 'hidden',
    },
    staff: {
      pupil: 'hidden',
      tpPupil: 'hidden',
      child: 'hidden',
      ownChild: 'hidden',
      self: 'hidden',
      unrelated: 'hidden',
      otherSchool: 'hidden',
    },
    teacherParent: {
      pupil: 'hidden',
      tpPupil: 'summary',
      child: 'hidden',
      ownChild: 'profile',
      self: 'hidden',
      unrelated: 'hidden',
      otherSchool: 'hidden',
    },
    otherSchoolAdmin: {
      pupil: 'hidden',
      tpPupil: 'hidden',
      child: 'hidden',
      ownChild: 'hidden',
      self: 'hidden',
      unrelated: 'hidden',
      otherSchool: 'profile',
    },
  };

  const userIds: Record<Caller, string> = {
    admin: '30000000-0000-4000-8000-000000000001',
    teacher: '30000000-0000-4000-8000-000000000002',
    parent: '30000000-0000-4000-8000-000000000003',
    student: '30000000-0000-4000-8000-000000000004',
    staff: '30000000-0000-4000-8000-000000000005',
    teacherParent: '30000000-0000-4000-8000-000000000006',
    otherSchoolAdmin: '30000000-0000-4000-8000-000000000007',
  };

  const schoolOf = (caller: Caller) => (caller === 'otherSchoolAdmin' ? OTHER_SCHOOL : SCHOOL);
  const memberships = {} as Record<Caller, string>;
  const studentIds = {} as Record<Target, string>;

  async function insert(sql: string, params: unknown[]): Promise<string> {
    const [row] = await owner.query<Array<{ id: string }>>(sql, params);
    return row.id;
  }

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

    await owner.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Greenfield', 'greenfield'), ($2, 'Brookvale', 'brookvale')`,
      [SCHOOL, OTHER_SCHOOL],
    );

    const rolesOf: Record<Caller, Role[]> = {
      admin: [Role.SchoolAdmin],
      teacher: [Role.Teacher],
      parent: [Role.Parent],
      student: [Role.Student],
      staff: [Role.Staff],
      teacherParent: [Role.Teacher, Role.Parent],
      otherSchoolAdmin: [Role.SchoolAdmin],
    };

    const rows = {} as Record<Caller, Partial<Record<Role, string>>>;
    for (const caller of CALLERS) {
      const seeded = await seedMember(owner, schoolOf(caller), userIds[caller], rolesOf[caller]);
      memberships[caller] = seeded.membershipId;
      rows[caller] = seeded.roleRows;
    }

    studentIds.self = rows.student[Role.Student]!;
    for (const target of ['pupil', 'tpPupil', 'child', 'ownChild', 'unrelated'] as const) {
      studentIds[target] = await seedRoleRow(owner, SCHOOL, Role.Student, null, {
        firstName: target,
      });
    }
    studentIds.otherSchool = await seedRoleRow(owner, OTHER_SCHOOL, Role.Student, null, {
      firstName: 'otherSchool',
    });

    const session = await insert(
      `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
       VALUES ($1, '2026/2027', '2026-09-01', '2027-07-31', true) RETURNING id`,
      [SCHOOL],
    );
    const grade = await insert(
      `INSERT INTO grade_levels (tenant_id, name, position) VALUES ($1, 'JSS 1', 7) RETURNING id`,
      [SCHOOL],
    );
    for (const [arm, teacher, student] of [
      ['A', rows.teacher[Role.Teacher], studentIds.pupil],
      ['B', rows.teacherParent[Role.Teacher], studentIds.tpPupil],
    ] as const) {
      const schoolClass = await insert(
        `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm) VALUES ($1, $2, $3, $4) RETURNING id`,
        [SCHOOL, session, grade, arm],
      );
      await owner.query(
        `INSERT INTO class_supervisors (tenant_id, class_id, teacher_id) VALUES ($1, $2, $3)`,
        [SCHOOL, schoolClass, teacher],
      );
      await owner.query(
        `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id) VALUES ($1, $2, $3, $4)`,
        [SCHOOL, schoolClass, session, student],
      );
    }

    await owner.query(
      `INSERT INTO guardianships (tenant_id, parent_id, student_id) VALUES ($1, $2, $3), ($1, $4, $5)`,
      [
        SCHOOL,
        rows.parent[Role.Parent],
        studentIds.child,
        rows.teacherParent[Role.Parent],
        studentIds.ownChild,
      ],
    );
  }, 120_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  /** What one caller gets back, by target, with roles read from the database. */
  async function viewOf(caller: Caller): Promise<Record<Target, Cell>> {
    const userId = userIds[caller];
    const tenantId = schoolOf(caller);

    const roles = await app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
      return rolesOfMembership(manager, tenantId, memberships[caller]);
    });

    const page = await runWithRequestContext(
      { origin: 'http', tenantId, userId, roles, requestId: 'matrix' },
      () =>
        app.transaction(async (manager) => {
          await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
          await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
          return new ListStudentsAction(manager).execute({ limit: 100, offset: 0 });
        }),
    );

    const seen = new Map(page.items.map((item) => [item.student.id, item.view]));
    const result = {} as Record<Target, Cell>;
    for (const target of TARGETS) {
      result[target] = seen.get(studentIds[target]) ?? 'hidden';
    }

    // Anything returned that is not one of the targets would be a leak the table
    // cannot express, so it fails here rather than passing silently.
    const known = new Set(Object.values(studentIds));
    expect(page.items.filter((item) => !known.has(item.student.id))).toEqual([]);
    expect(page.total).toBe(page.items.length);

    return result;
  }

  it.each(CALLERS)('%s', async (caller) => {
    expect(await viewOf(caller)).toEqual(EXPECTED[caller]);
  });

  it('covers every caller and every target, so the table is complete', () => {
    for (const caller of CALLERS) {
      expect(Object.keys(EXPECTED[caller]).sort()).toEqual([...TARGETS].sort());
    }
  });

  describe('a parent loses access through any link in the chain', () => {
    async function parentSeesChild(): Promise<boolean> {
      return (await viewOf('parent')).child !== 'hidden';
    }

    it('when the guardianship is removed', async () => {
      await owner.query(`UPDATE guardianships SET deleted_at = now() WHERE student_id = $1`, [
        studentIds.child,
      ]);
      try {
        expect(await parentSeesChild()).toBe(false);
      } finally {
        await owner.query(`UPDATE guardianships SET deleted_at = NULL WHERE student_id = $1`, [
          studentIds.child,
        ]);
      }
    });

    it('when the parent record is removed', async () => {
      await owner.query(`UPDATE parents SET deleted_at = now() WHERE membership_id = $1`, [
        memberships.parent,
      ]);
      try {
        // The PARENT role disappears with the row, so no branch applies at all.
        expect(await parentSeesChild()).toBe(false);
      } finally {
        await owner.query(`UPDATE parents SET deleted_at = NULL WHERE membership_id = $1`, [
          memberships.parent,
        ]);
      }
    });

    it('when the membership is suspended', async () => {
      await owner.query(`UPDATE memberships SET status = 'SUSPENDED' WHERE id = $1`, [
        memberships.parent,
      ]);
      try {
        expect(await parentSeesChild()).toBe(false);
      } finally {
        await owner.query(`UPDATE memberships SET status = 'ACTIVE' WHERE id = $1`, [
          memberships.parent,
        ]);
      }
    });

    it('and sees the child again once everything is restored', async () => {
      expect(await parentSeesChild()).toBe(true);
    });
  });
});
