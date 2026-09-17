import { DataSource } from 'typeorm';

import { AttendanceStatus, AttendanceType } from '../src/attendance/attendance.enums';
import { ReadAttendanceAction } from '../src/attendance/read-attendance.action';
import { Role } from '../src/auth/permission.matrix';
import { rolesOfMembership } from '../src/tenancy/membership-roles';
import { runWithRequestContext } from '../src/tenancy/request-context';
import { APP_ROLE_PASSWORD } from './app-database.env';
import { seedAcademicYear, seedAttendance, seedClass } from './attendance.fixtures';
import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';
import { seedMember, seedRoleRow } from './people.fixtures';

/**
 * Who sees which attendance record: every cell, stated.
 *
 * Blueprint section 95, as a table rather than a sample, for the same reason the
 * student visibility matrix is one: with five roles and three kinds of subject,
 * the dangerous cells are the ones nobody would think to write a test for. Each
 * row below is a near miss on purpose, which is what the review asked for: a
 * teacher reading a class they do not supervise, a parent reading a child who is
 * not theirs, a student reading a classmate, a staff member reading a colleague.
 *
 * Roles are read from the real `membership_roles` view, so a caller's roles here
 * are what the database says rather than what this file asserts.
 */
describe('attendance visibility', () => {
  let owner: DataSource;
  let app: DataSource;

  const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const OTHER_SCHOOL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const CALLERS = ['admin', 'teacher', 'parent', 'student', 'staff', 'otherSchoolAdmin'] as const;
  type Caller = (typeof CALLERS)[number];

  const RECORDS = [
    'pupilDay',
    'childDay',
    'selfStudentDay',
    'teacherOwnDay',
    'staffOwnDay',
    'otherStaffDay',
    'otherSchoolDay',
  ] as const;
  type Row = (typeof RECORDS)[number];

  /**
   * The whole rule.
   *
   * - pupilDay: a student in the class the teacher supervises.
   * - childDay: the parent's linked child, in a class the teacher does not take.
   * - selfStudentDay: the student caller's own day, in that same other class.
   * - teacherOwnDay: the teacher's own attendance.
   * - staffOwnDay: the staff caller's own attendance.
   * - otherStaffDay: a colleague's attendance.
   * - otherSchoolDay: a record belonging to another school.
   */
  const EXPECTED: Readonly<Record<Caller, readonly Row[]>> = {
    admin: [
      'pupilDay',
      'childDay',
      'selfStudentDay',
      'teacherOwnDay',
      'staffOwnDay',
      'otherStaffDay',
    ],
    teacher: ['pupilDay', 'teacherOwnDay'],
    parent: ['childDay'],
    student: ['selfStudentDay'],
    staff: ['staffOwnDay'],
    otherSchoolAdmin: ['otherSchoolDay'],
  };

  const userIds: Record<Caller, string> = {
    admin: '50000000-0000-4000-8000-000000000001',
    teacher: '50000000-0000-4000-8000-000000000002',
    parent: '50000000-0000-4000-8000-000000000003',
    student: '50000000-0000-4000-8000-000000000004',
    staff: '50000000-0000-4000-8000-000000000005',
    otherSchoolAdmin: '50000000-0000-4000-8000-000000000006',
  };

  const schoolOf = (caller: Caller) => (caller === 'otherSchoolAdmin' ? OTHER_SCHOOL : SCHOOL);
  const memberships = {} as Record<Caller, string>;
  const recordIds = {} as Record<Row, string>;

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
      `INSERT INTO tenants (id, name, slug)
       VALUES ($1, 'Greenfield', 'greenfield'), ($2, 'Brookvale', 'brookvale')`,
      [SCHOOL, OTHER_SCHOOL],
    );

    const rolesOf: Record<Caller, Role[]> = {
      admin: [Role.SchoolAdmin],
      teacher: [Role.Teacher],
      parent: [Role.Parent],
      student: [Role.Student],
      staff: [Role.Staff],
      otherSchoolAdmin: [Role.SchoolAdmin],
    };

    const rows = {} as Record<Caller, Partial<Record<Role, string>>>;

    for (const caller of CALLERS) {
      const seeded = await seedMember(owner, schoolOf(caller), userIds[caller], rolesOf[caller]);
      memberships[caller] = seeded.membershipId;
      rows[caller] = seeded.roleRows;
    }

    const markedBy = memberships.admin;
    const year = await seedAcademicYear(owner, SCHOOL);

    // The teacher's class, and one child in it who is related to nobody else.
    const supervised = await seedClass(owner, SCHOOL, year, {
      arm: 'A',
      supervisorTeacherId: rows.teacher[Role.Teacher],
      studentCount: 1,
    });

    // A class the teacher has nothing to do with, holding the parent's child and
    // the student caller. Putting the student caller here rather than in the
    // supervised class is what makes "a teacher cannot read a classmate's day"
    // and "a student cannot read a classmate's day" two separate cells.
    const child = rows.parent[Role.Parent];
    const childStudentId = await seedRoleRow(owner, SCHOOL, Role.Student, null, {
      firstName: 'Child',
    });
    const otherClass = await seedClass(owner, SCHOOL, year, {
      arm: 'B',
      students: [childStudentId, rows.student[Role.Student]!],
    });

    await owner.query(
      `INSERT INTO guardianships (tenant_id, parent_id, student_id) VALUES ($1, $2, $3)`,
      [SCHOOL, child, childStudentId],
    );

    const studentDay = async (
      studentId: string,
      seeded: Awaited<ReturnType<typeof seedClass>>,
    ): Promise<string> =>
      seedAttendance(owner, SCHOOL, {
        type: AttendanceType.Student,
        status: AttendanceStatus.Present,
        markedBy,
        studentId,
        enrolmentId: seeded.enrolmentIds[studentId],
        classId: seeded.classId,
        sessionId: year.sessionId,
        termId: year.termId,
      });

    recordIds.pupilDay = await studentDay(supervised.studentIds[0], supervised);
    recordIds.childDay = await studentDay(childStudentId, otherClass);
    recordIds.selfStudentDay = await studentDay(rows.student[Role.Student]!, otherClass);

    recordIds.teacherOwnDay = await seedAttendance(owner, SCHOOL, {
      type: AttendanceType.Teacher,
      status: AttendanceStatus.Present,
      markedBy,
      teacherId: rows.teacher[Role.Teacher],
    });

    recordIds.staffOwnDay = await seedAttendance(owner, SCHOOL, {
      type: AttendanceType.Staff,
      status: AttendanceStatus.Present,
      markedBy,
      staffId: rows.staff[Role.Staff],
    });

    const colleague = await seedRoleRow(owner, SCHOOL, Role.Staff, null, {
      firstName: 'Colleague',
    });
    recordIds.otherStaffDay = await seedAttendance(owner, SCHOOL, {
      type: AttendanceType.Staff,
      status: AttendanceStatus.Present,
      markedBy,
      staffId: colleague,
    });

    // The other school's own world, so the sweep has something to fail to see.
    const otherYear = await seedAcademicYear(owner, OTHER_SCHOOL);
    const otherClassElsewhere = await seedClass(owner, OTHER_SCHOOL, otherYear, {
      arm: 'A',
      studentCount: 1,
    });
    recordIds.otherSchoolDay = await seedAttendance(owner, OTHER_SCHOOL, {
      type: AttendanceType.Student,
      status: AttendanceStatus.Present,
      markedBy: memberships.otherSchoolAdmin,
      studentId: otherClassElsewhere.studentIds[0],
      enrolmentId: otherClassElsewhere.enrolmentIds[otherClassElsewhere.studentIds[0]],
      classId: otherClassElsewhere.classId,
      sessionId: otherYear.sessionId,
      termId: otherYear.termId,
    });
  }, 180_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  /** Every record one caller can see, named. */
  async function visibleTo(caller: Caller): Promise<Row[]> {
    const userId = userIds[caller];
    const tenantId = schoolOf(caller);

    const roles = await app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);

      return rolesOfMembership(manager, tenantId, memberships[caller]);
    });

    const page = await runWithRequestContext(
      { origin: 'http', tenantId, userId, roles, requestId: 'attendance-matrix' },
      () =>
        app.transaction(async (manager) => {
          await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
          await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

          return new ReadAttendanceAction(manager).list({}, { limit: 100, offset: 0 });
        }),
    );

    const seen = new Set(page.items.map((item) => item.id));

    return RECORDS.filter((name) => seen.has(recordIds[name]));
  }

  it.each(CALLERS)('%s sees exactly the records section 95 allows', async (caller) => {
    expect((await visibleTo(caller)).sort()).toEqual([...EXPECTED[caller]].sort());
  });

  it('counts only what the caller may see, so paging cannot walk the boundary', async () => {
    const userId = userIds.parent;

    const roles = await app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);

      return rolesOfMembership(manager, SCHOOL, memberships.parent);
    });

    const page = await runWithRequestContext(
      { origin: 'http', tenantId: SCHOOL, userId, roles, requestId: 'attendance-total' },
      () =>
        app.transaction(async (manager) => {
          await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
          await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [SCHOOL]);

          return new ReadAttendanceAction(manager).list({}, { limit: 1, offset: 0 });
        }),
    );

    expect(page.total).toBe(1);
  });

  it('gives a member with no roles nothing, rather than everything', async () => {
    const userId = '50000000-0000-4000-8000-00000000000f';
    const { membershipId } = await seedMember(owner, SCHOOL, userId, []);

    const page = await runWithRequestContext(
      { origin: 'http', tenantId: SCHOOL, userId, roles: [], requestId: 'attendance-no-roles' },
      () =>
        app.transaction(async (manager) => {
          await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
          await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [SCHOOL]);

          return new ReadAttendanceAction(manager).list({}, { limit: 100, offset: 0 });
        }),
    );

    expect(membershipId).toBeDefined();
    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(0);
  });
});
