// Must come first: it sets the database connection before the app loads.
import { type E2eHarness, request, startE2e } from './e2e.harness';

import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import { AttendanceStatus, AttendanceType } from '../src/attendance/attendance.enums';
import { Role } from '../src/auth/permission.matrix';
import { collectRoutes } from '../src/common/testing/route-inventory';
import {
  HOLIDAY,
  SCHOOL_DAY,
  seedAcademicYear,
  seedAttendance,
  seedClass,
} from './attendance.fixtures';
import { seedMember, seedRoleRow } from './people.fixtures';

/**
 * Attendance over HTTP, and every one of its routes attacked from another school.
 *
 * The sweep is generated from the application's own route inventory, as in the
 * people module: a route added later with no case fails the build, and a case
 * for a route that no longer exists fails too. The behavioural tests below it are
 * the near misses blueprint section 95 is actually about.
 */
describe('attendance end to end', () => {
  let e2e: E2eHarness;

  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const users = {
    adminA: '60000000-0000-4000-8000-000000000001',
    teacherA: '60000000-0000-4000-8000-000000000002',
    otherTeacherA: '60000000-0000-4000-8000-000000000003',
    parentA: '60000000-0000-4000-8000-000000000004',
    studentA: '60000000-0000-4000-8000-000000000005',
    staffA: '60000000-0000-4000-8000-000000000006',
    adminB: '60000000-0000-4000-8000-000000000011',
  } as const;

  /** School A, set during seeding. */
  const a = {} as Record<
    | 'supervisedClass'
    | 'otherClass'
    | 'pupilOne'
    | 'pupilTwo'
    | 'otherPupil'
    | 'childStudent'
    | 'selfStudent'
    | 'teacherRecord'
    | 'otherTeacherRecord'
    | 'staffRecord'
    | 'colleagueRecord'
    | 'adminMembership'
    | 'seededRecord',
    string
  >;

  /** School B: one of everything the sweep aims at. */
  const b = {} as Record<'class' | 'student' | 'teacher' | 'staff' | 'record', string>;

  beforeAll(async () => {
    e2e = await startE2e(
      async (owner) => {
        await owner.query(
          `INSERT INTO tenants (id, name, slug) VALUES
           ($1, 'Greenfield', 'greenfield'), ($2, 'Brookvale', 'brookvale')`,
          [A, B],
        );

        const admin = await seedMember(owner, A, users.adminA, [Role.SchoolAdmin]);
        a.adminMembership = admin.membershipId;

        const teacher = await seedMember(owner, A, users.teacherA, [Role.Teacher]);
        a.teacherRecord = teacher.roleRows[Role.Teacher]!;

        const otherTeacher = await seedMember(owner, A, users.otherTeacherA, [Role.Teacher]);
        a.otherTeacherRecord = otherTeacher.roleRows[Role.Teacher]!;

        const parent = await seedMember(owner, A, users.parentA, [Role.Parent]);
        const student = await seedMember(owner, A, users.studentA, [Role.Student]);
        a.selfStudent = student.roleRows[Role.Student]!;

        const staff = await seedMember(owner, A, users.staffA, [Role.Staff]);
        a.staffRecord = staff.roleRows[Role.Staff]!;
        a.colleagueRecord = await seedRoleRow(owner, A, Role.Staff, null, {
          firstName: 'Colleague',
        });

        const year = await seedAcademicYear(owner, A);

        a.childStudent = await seedRoleRow(owner, A, Role.Student, null, { firstName: 'Child' });
        await owner.query(
          `INSERT INTO guardianships (tenant_id, parent_id, student_id) VALUES ($1, $2, $3)`,
          [A, parent.roleRows[Role.Parent], a.childStudent],
        );

        // The class this teacher supervises, holding two children and the
        // parent's child, so one register covers reading and marking.
        const supervised = await seedClass(owner, A, year, {
          arm: 'A',
          supervisorTeacherId: a.teacherRecord,
          students: [a.childStudent],
          studentCount: 3,
        });
        a.supervisedClass = supervised.classId;
        a.pupilOne = supervised.studentIds[1]!;
        a.pupilTwo = supervised.studentIds[2]!;

        // A class the first teacher has nothing to do with.
        const other = await seedClass(owner, A, year, {
          arm: 'B',
          supervisorTeacherId: a.otherTeacherRecord,
          students: [a.selfStudent],
          studentCount: 2,
        });
        a.otherClass = other.classId;
        a.otherPupil = other.studentIds[1]!;

        // A record that exists before any request, for the read routes.
        a.seededRecord = await seedAttendance(owner, A, {
          type: AttendanceType.Student,
          status: AttendanceStatus.Present,
          markedBy: a.adminMembership,
          date: '2026-09-08',
          studentId: a.selfStudent,
          enrolmentId: other.enrolmentIds[a.selfStudent],
          classId: other.classId,
          sessionId: year.sessionId,
          termId: year.termId,
        });

        // School B, complete enough to aim every route at.
        const adminB = await seedMember(owner, B, users.adminB, [Role.SchoolAdmin]);
        const teacherB = await seedMember(owner, B, `${users.adminB.slice(0, -1)}2`, [
          Role.Teacher,
        ]);
        b.teacher = teacherB.roleRows[Role.Teacher]!;
        b.staff = await seedRoleRow(owner, B, Role.Staff, null, { firstName: 'BStaff' });

        const yearB = await seedAcademicYear(owner, B);
        const classB = await seedClass(owner, B, yearB, { arm: 'A', studentCount: 1 });
        b.class = classB.classId;
        b.student = classB.studentIds[0]!;
        b.record = await seedAttendance(owner, B, {
          type: AttendanceType.Student,
          status: AttendanceStatus.Present,
          markedBy: adminB.membershipId,
          studentId: b.student,
          enrolmentId: classB.enrolmentIds[b.student],
          classId: classB.classId,
          sessionId: yearB.sessionId,
          termId: yearB.termId,
        });
      },
      [DiscoveryModule],
    );
  }, 240_000);

  afterAll(async () => {
    await e2e?.close();
  });

  const as = async (userId: string) => ({ authorization: await e2e.bearer(userId) });

  interface Item {
    id: string;
    studentId?: string | null;
    status?: string;
  }

  const items = (response: { body: unknown }) =>
    (response.body as { data: { items: Item[] } }).data.items;
  const data = <T>(response: { body: unknown }) => (response.body as { data: T }).data;
  const message = (response: { body: unknown }) => (response.body as { message: string }).message;
  /** A 422 keeps its specifics in `details`; `message` stays the generic one. */
  const details = (response: { body: unknown }) =>
    ((response.body as { details?: string[] }).details ?? []).join(' ');

  /** Attendance rows in a school, read as the owner. */
  async function rowsIn(tenantId: string, classId: string, date: string): Promise<number> {
    const rows = await e2e.owner.query<unknown[]>(
      `SELECT 1 FROM attendance WHERE tenant_id = $1 AND class_id = $2 AND date = $3::date`,
      [tenantId, classId, date],
    );

    return rows.length;
  }

  // -------------------------------------------------------------------------
  // The cross-school sweep
  // -------------------------------------------------------------------------

  describe("every attendance route, attacked with another school's ids", () => {
    const ATTENDANCE_CONTROLLERS = new Set([
      'StudentAttendanceController',
      'EmployeeAttendanceController',
      'AttendanceRecordsController',
    ]);

    const CASES: Record<string, () => Promise<void>> = {
      'POST /classes/:classId/attendance': async () => {
        // Counted before and after rather than asserted to be zero: this suite
        // seeds a record in school B itself, and a test that only checks the
        // total would pass while writing one more.
        const before = await rowsIn(B, b.class, SCHOOL_DAY);

        await request(e2e.server())
          .post(`/api/v1/classes/${b.class}/attendance`)
          .set(await as(users.adminA))
          .send({ date: SCHOOL_DAY, entries: [{ studentId: b.student, status: 'PRESENT' }] })
          .expect(404);

        expect(await rowsIn(B, b.class, SCHOOL_DAY)).toBe(before);
      },
      'GET /classes/:classId/attendance': async () => {
        const response = await request(e2e.server())
          .get(`/api/v1/classes/${b.class}/attendance`)
          .set(await as(users.adminA))
          .expect(200);

        expect(items(response)).toHaveLength(0);
      },
      'GET /students/:studentId/attendance': async () => {
        const response = await request(e2e.server())
          .get(`/api/v1/students/${b.student}/attendance`)
          .set(await as(users.adminA))
          .expect(200);

        expect(items(response)).toHaveLength(0);
      },
      'POST /teachers/:teacherId/attendance': async () => {
        await request(e2e.server())
          .post(`/api/v1/teachers/${b.teacher}/attendance`)
          .set(await as(users.adminA))
          .send({ date: SCHOOL_DAY, status: 'PRESENT' })
          .expect(404);
      },
      'GET /teachers/:teacherId/attendance': async () => {
        const response = await request(e2e.server())
          .get(`/api/v1/teachers/${b.teacher}/attendance`)
          .set(await as(users.adminA))
          .expect(200);

        expect(items(response)).toHaveLength(0);
      },
      'POST /staff/:staffId/attendance': async () => {
        await request(e2e.server())
          .post(`/api/v1/staff/${b.staff}/attendance`)
          .set(await as(users.adminA))
          .send({ date: SCHOOL_DAY, status: 'PRESENT' })
          .expect(404);
      },
      'GET /staff/:staffId/attendance': async () => {
        const response = await request(e2e.server())
          .get(`/api/v1/staff/${b.staff}/attendance`)
          .set(await as(users.adminA))
          .expect(200);

        expect(items(response)).toHaveLength(0);
      },
      'POST /me/attendance/check-in': async () => {
        // Nothing to aim at: the subject is the caller. What must hold is that
        // the record lands in the caller's school and against their own record.
        const response = await request(e2e.server())
          .post('/api/v1/me/attendance/check-in')
          .set(await as(users.staffA))
          .send({ date: '2026-09-02' })
          .expect(201);

        const [row] = await e2e.owner.query<Array<{ tenant_id: string; staff_id: string }>>(
          `SELECT tenant_id, staff_id FROM attendance WHERE id = $1`,
          [data<{ id: string }>(response).id],
        );

        expect(row).toMatchObject({ tenant_id: A, staff_id: a.staffRecord });
      },
      'GET /attendance': async () => {
        const response = await request(e2e.server())
          .get('/api/v1/attendance')
          .set(await as(users.adminA))
          .expect(200);

        expect(items(response).map((item) => item.id)).not.toContain(b.record);
      },
      'GET /attendance/:id': async () => {
        await request(e2e.server())
          .get(`/api/v1/attendance/${b.record}`)
          .set(await as(users.adminA))
          .expect(404);
      },
      'GET /attendance/:id/corrections': async () => {
        await request(e2e.server())
          .get(`/api/v1/attendance/${b.record}/corrections`)
          .set(await as(users.adminA))
          .expect(404);
      },
      'POST /attendance/:id/corrections': async () => {
        await request(e2e.server())
          .post(`/api/v1/attendance/${b.record}/corrections`)
          .set(await as(users.adminA))
          .send({ status: 'ABSENT', reason: 'Trying it on.' })
          .expect(404);

        const [row] = await e2e.owner.query<Array<{ status: string }>>(
          `SELECT status FROM attendance WHERE id = $1`,
          [b.record],
        );

        expect(row.status).toBe('PRESENT');
      },
    };

    it('has a case for every attendance route, and none for a route that is gone', () => {
      const routes = collectRoutes(
        e2e.app.get(DiscoveryService),
        e2e.app.get(MetadataScanner),
        e2e.app.get(Reflector),
      )
        .filter((route) => ATTENDANCE_CONTROLLERS.has(route.controller))
        .map((route) => `${route.method} ${route.path}`)
        .sort();

      expect(routes.length).toBeGreaterThan(0);
      expect(routes).toEqual(Object.keys(CASES).sort());
    });

    it.each(Object.keys(CASES).sort())('%s', async (signature) => {
      await CASES[signature]();
    });
  });

  // -------------------------------------------------------------------------
  // Taking a register
  // -------------------------------------------------------------------------

  describe('taking a register', () => {
    it('records the whole class in one request, with the academic context filled in', async () => {
      const response = await request(e2e.server())
        .post(`/api/v1/classes/${a.supervisedClass}/attendance`)
        .set(await as(users.teacherA))
        .send({
          date: SCHOOL_DAY,
          entries: [
            { studentId: a.childStudent, status: 'PRESENT' },
            { studentId: a.pupilOne, status: 'LATE', remarks: 'Bus was late' },
            { studentId: a.pupilTwo, status: 'ABSENT' },
          ],
        })
        .expect(201);

      expect(data<Item[]>(response)).toHaveLength(3);

      const [row] = await e2e.owner.query<
        Array<{ class_id: string; session_id: string; term_id: string; enrolment_id: string }>
      >(
        `SELECT class_id, session_id, term_id, enrolment_id
           FROM attendance WHERE student_id = $1 AND date = $2::date`,
        [a.pupilOne, SCHOOL_DAY],
      );

      // Not supplied by the request: taken from the enrolment the insert joined.
      expect(row.class_id).toBe(a.supervisedClass);
      expect(row.session_id).toBeTruthy();
      expect(row.term_id).toBeTruthy();
      expect(row.enrolment_id).toBeTruthy();
    });

    it('refuses a second register for the same day and names who is already marked', async () => {
      const response = await request(e2e.server())
        .post(`/api/v1/classes/${a.supervisedClass}/attendance`)
        .set(await as(users.teacherA))
        .send({ date: SCHOOL_DAY, entries: [{ studentId: a.pupilOne, status: 'PRESENT' }] })
        .expect(409);

      expect(message(response)).toContain(a.pupilOne);
    });

    it('refuses a teacher a class they do not supervise', async () => {
      await request(e2e.server())
        .post(`/api/v1/classes/${a.otherClass}/attendance`)
        .set(await as(users.teacherA))
        .send({ date: SCHOOL_DAY, entries: [{ studentId: a.otherPupil, status: 'PRESENT' }] })
        .expect(403);

      expect(await rowsIn(A, a.otherClass, SCHOOL_DAY)).toBe(0);
    });

    it('refuses a student who is not in that class, and names them', async () => {
      const response = await request(e2e.server())
        .post(`/api/v1/classes/${a.supervisedClass}/attendance`)
        .set(await as(users.teacherA))
        .send({ date: '2026-09-07', entries: [{ studentId: a.otherPupil, status: 'PRESENT' }] })
        .expect(422);

      expect(details(response)).toContain(a.otherPupil);
      expect(await rowsIn(A, a.supervisedClass, '2026-09-07')).toBe(0);
    });

    it('refuses LEAVE for a student, which is a teacher and staff status', async () => {
      await request(e2e.server())
        .post(`/api/v1/classes/${a.supervisedClass}/attendance`)
        .set(await as(users.teacherA))
        .send({ date: '2026-09-04', entries: [{ studentId: a.pupilOne, status: 'LEAVE' }] })
        .expect(422);
    });

    it('refuses a date in no term of the current session', async () => {
      await request(e2e.server())
        .post(`/api/v1/classes/${a.supervisedClass}/attendance`)
        .set(await as(users.teacherA))
        .send({ date: HOLIDAY, entries: [{ studentId: a.pupilOne, status: 'PRESENT' }] })
        .expect(422);
    });

    it('refuses a date that has not happened yet', async () => {
      await request(e2e.server())
        .post(`/api/v1/classes/${a.supervisedClass}/attendance`)
        .set(await as(users.teacherA))
        .send({ date: '2026-12-15', entries: [{ studentId: a.pupilOne, status: 'PRESENT' }] })
        .expect(422);
    });

    it('refuses a roster naming the same student twice', async () => {
      await request(e2e.server())
        .post(`/api/v1/classes/${a.supervisedClass}/attendance`)
        .set(await as(users.teacherA))
        .send({
          date: '2026-09-03',
          entries: [
            { studentId: a.pupilOne, status: 'PRESENT' },
            { studentId: a.pupilOne, status: 'ABSENT' },
          ],
        })
        .expect(422);
    });

    it('refuses a parent the marking endpoint at all', async () => {
      await request(e2e.server())
        .post(`/api/v1/classes/${a.supervisedClass}/attendance`)
        .set(await as(users.parentA))
        .send({ date: '2026-09-02', entries: [{ studentId: a.childStudent, status: 'PRESENT' }] })
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // Employees
  // -------------------------------------------------------------------------

  describe('teachers and staff', () => {
    it('lets a staff member check themselves in, once a day', async () => {
      await request(e2e.server())
        .post('/api/v1/me/attendance/check-in')
        .set(await as(users.staffA))
        .send({ date: SCHOOL_DAY })
        .expect(201);

      await request(e2e.server())
        .post('/api/v1/me/attendance/check-in')
        .set(await as(users.staffA))
        .send({ date: SCHOOL_DAY })
        .expect(409);
    });

    it('refuses a staff member recording a colleague', async () => {
      await request(e2e.server())
        .post(`/api/v1/staff/${a.colleagueRecord}/attendance`)
        .set(await as(users.staffA))
        .send({ date: SCHOOL_DAY, status: 'PRESENT' })
        .expect(403);
    });

    it('lets an administrator record anyone, including LEAVE', async () => {
      const response = await request(e2e.server())
        .post(`/api/v1/teachers/${a.teacherRecord}/attendance`)
        .set(await as(users.adminA))
        .send({ date: SCHOOL_DAY, status: 'LEAVE' })
        .expect(201);

      expect(data<Item>(response).status).toBe('LEAVE');
    });

    it('refuses a student the marking endpoint', async () => {
      await request(e2e.server())
        .post('/api/v1/me/attendance/check-in')
        .set(await as(users.studentA))
        .send({})
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // Corrections
  // -------------------------------------------------------------------------

  describe('corrections', () => {
    it('lets an administrator change a status and records why', async () => {
      const [record] = await e2e.owner.query<Array<{ id: string }>>(
        `SELECT id FROM attendance WHERE student_id = $1 AND date = $2::date`,
        [a.pupilTwo, SCHOOL_DAY],
      );

      await request(e2e.server())
        .post(`/api/v1/attendance/${record.id}/corrections`)
        .set(await as(users.adminA))
        .send({ status: 'PRESENT', reason: 'Marked absent in error; arrived at registration.' })
        .expect(201);

      const history = await request(e2e.server())
        .get(`/api/v1/attendance/${record.id}/corrections`)
        .set(await as(users.adminA))
        .expect(200);

      expect(data<Array<Record<string, unknown>>>(history)).toHaveLength(1);
      expect(data<Array<Record<string, unknown>>>(history)[0]).toMatchObject({
        previousStatus: 'ABSENT',
        newStatus: 'PRESENT',
        reason: 'Marked absent in error; arrived at registration.',
        changedBy: a.adminMembership,
      });
    });

    it('refuses a teacher the correction endpoint, per section 95', async () => {
      await request(e2e.server())
        .post(`/api/v1/attendance/${a.seededRecord}/corrections`)
        .set(await as(users.teacherA))
        .send({ status: 'ABSENT', reason: 'I think this is wrong.' })
        .expect(403);
    });

    it('refuses a correction with no reason', async () => {
      await request(e2e.server())
        .post(`/api/v1/attendance/${a.seededRecord}/corrections`)
        .set(await as(users.adminA))
        .send({ status: 'ABSENT' })
        .expect(400);
    });

    it('refuses a correction to the status the record already has', async () => {
      await request(e2e.server())
        .post(`/api/v1/attendance/${a.seededRecord}/corrections`)
        .set(await as(users.adminA))
        .send({ status: 'PRESENT', reason: 'No change at all.' })
        .expect(422);
    });
  });

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  describe('who reads what', () => {
    it("gives a parent their child's days and nobody else's", async () => {
      const mine = await request(e2e.server())
        .get(`/api/v1/students/${a.childStudent}/attendance`)
        .set(await as(users.parentA))
        .expect(200);

      expect(items(mine).length).toBeGreaterThan(0);

      const theirs = await request(e2e.server())
        .get(`/api/v1/students/${a.pupilOne}/attendance`)
        .set(await as(users.parentA))
        .expect(200);

      expect(items(theirs)).toHaveLength(0);
    });

    it('gives a student their own days and not a classmate’s', async () => {
      const mine = await request(e2e.server())
        .get(`/api/v1/students/${a.selfStudent}/attendance`)
        .set(await as(users.studentA))
        .expect(200);

      expect(items(mine).map((item) => item.id)).toContain(a.seededRecord);

      const theirs = await request(e2e.server())
        .get(`/api/v1/students/${a.otherPupil}/attendance`)
        .set(await as(users.studentA))
        .expect(200);

      expect(items(theirs)).toHaveLength(0);
    });

    it('gives a teacher the register they took, and not the other class', async () => {
      const mine = await request(e2e.server())
        .get(`/api/v1/classes/${a.supervisedClass}/attendance?date=${SCHOOL_DAY}`)
        .set(await as(users.teacherA))
        .expect(200);

      expect(items(mine)).toHaveLength(3);

      const theirs = await request(e2e.server())
        .get(`/api/v1/classes/${a.otherClass}/attendance`)
        .set(await as(users.teacherA))
        .expect(200);

      expect(items(theirs)).toHaveLength(0);
    });
  });
});
