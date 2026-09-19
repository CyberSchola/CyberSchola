// Must come first: it sets the database connection before the app loads.
import { type E2eHarness, request, startE2e } from './e2e.harness';

import Redis from 'ioredis';

import { reportKey } from '../src/attendance/attendance-report-cache';
import { AttendanceStatus, AttendanceType } from '../src/attendance/attendance.enums';
import { NO_PERIOD_COVERS_DATE } from '../src/attendance/report-attendance.action';
import { ReportGrouping, ReportPeriod } from '../src/attendance/report-period';
import { Role } from '../src/auth/permission.matrix';
import { seedAcademicYear, seedAttendance, seedClass } from './attendance.fixtures';
import { seedMember } from './people.fixtures';

interface Row {
  group: { id: string | null; label: string };
  present: number;
  absent: number;
  late: number;
  excused: number;
  sick: number;
  leave: number;
  total: number;
  rate: number;
}

interface Report {
  period: { kind: string; from: string; to: string; label?: string };
  groupBy: string;
  rows: Row[];
}

/**
 * Attendance reports and their cache, over HTTP, against real Postgres and Redis.
 *
 * The cache cases look at Redis itself rather than trusting the answers: a
 * correct answer computed live and a correct answer served from a key that
 * should never have existed look the same from outside. So each case counts the
 * keys before and after, and the race is played out step by step by the test
 * rather than hoped for under load.
 */
describe('attendance reports', () => {
  let e2e: E2eHarness;
  let redis: Redis;

  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const WEEK_DAY = '2026-09-16';

  const users = {
    adminA: 'a1000000-0000-4000-8000-000000000001',
    teacherA: 'a1000000-0000-4000-8000-000000000002',
    parentA: 'a1000000-0000-4000-8000-000000000003',
    adminB: 'b1000000-0000-4000-8000-000000000001',
  } as const;

  const a = {} as Record<
    'classA' | 'childStudent' | 'pupil' | 'unmarked' | 'adminMembership',
    string
  >;

  beforeAll(async () => {
    e2e = await startE2e(async (owner) => {
      await owner.query(
        `INSERT INTO tenants (id, name, slug) VALUES
         ($1, 'Greenfield', 'greenfield'), ($2, 'Brookvale', 'brookvale')`,
        [A, B],
      );

      // School A: last session with one term, so a past term can be reported;
      // then the current session and a class with three pupils.
      const past = await owner.query<Array<{ id: string }>>(
        `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
         VALUES ($1, '2025/2026', '2025-09-01', '2026-07-31', false) RETURNING id`,
        [A],
      );
      await owner.query(
        `INSERT INTO terms (tenant_id, session_id, name, starts_on, ends_on)
         VALUES ($1, $2, 'Second Term', '2026-01-05', '2026-04-10')`,
        [A, past[0].id],
      );

      const admin = await seedMember(owner, A, users.adminA, [Role.SchoolAdmin]);
      a.adminMembership = admin.membershipId;
      const teacher = await seedMember(owner, A, users.teacherA, [Role.Teacher]);
      const parent = await seedMember(owner, A, users.parentA, [Role.Parent]);

      const year = await seedAcademicYear(owner, A, { gradeLevel: 'JSS 2' });
      const klass = await seedClass(owner, A, year, {
        arm: 'A',
        supervisorTeacherId: teacher.roleRows[Role.Teacher],
        studentCount: 3,
      });
      a.classA = klass.classId;
      [a.childStudent, a.pupil, a.unmarked] = klass.studentIds as [string, string, string];

      await owner.query(
        `INSERT INTO guardianships (tenant_id, parent_id, student_id) VALUES ($1, $2, $3)`,
        [A, parent.roleRows[Role.Parent], a.childStudent],
      );

      // Monday, Tuesday and Wednesday of one week for two pupils; the third is
      // never marked, so nothing should ever count them.
      const days: Array<[string, string, AttendanceStatus]> = [
        [a.childStudent, '2026-09-14', AttendanceStatus.Present],
        [a.childStudent, '2026-09-15', AttendanceStatus.Late],
        [a.childStudent, '2026-09-16', AttendanceStatus.Absent],
        [a.pupil, '2026-09-14', AttendanceStatus.Present],
        [a.pupil, '2026-09-15', AttendanceStatus.Sick],
        [a.pupil, '2026-09-16', AttendanceStatus.Present],
      ];

      for (const [studentId, date, status] of days) {
        await seedAttendance(owner, A, {
          type: AttendanceType.Student,
          status,
          markedBy: admin.membershipId,
          date,
          studentId,
          enrolmentId: klass.enrolmentIds[studentId],
          classId: klass.classId,
          sessionId: year.sessionId,
          termId: year.termId,
        });
      }

      // School B: the same shape, different numbers, so an identical query from
      // each school must come back different.
      const adminB = await seedMember(owner, B, users.adminB, [Role.SchoolAdmin]);
      const yearB = await seedAcademicYear(owner, B, { gradeLevel: 'JSS 2' });
      const classB = await seedClass(owner, B, yearB, { arm: 'A', studentCount: 1 });
      await seedAttendance(owner, B, {
        type: AttendanceType.Student,
        status: AttendanceStatus.Absent,
        markedBy: adminB.membershipId,
        date: WEEK_DAY,
        studentId: classB.studentIds[0],
        enrolmentId: classB.enrolmentIds[classB.studentIds[0]],
        classId: classB.classId,
        sessionId: yearB.sessionId,
        termId: yearB.termId,
      });
    });

    redis = new Redis(process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? '');
  }, 240_000);

  afterAll(async () => {
    await redis?.quit();
    await e2e?.close();
  });

  beforeEach(async () => {
    // Each case starts with nothing cached for either school.
    for (const school of [A, B]) {
      const keys = await redis.keys(`tenant:${school}:attendance:*`);

      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  });

  const as = async (userId: string) => ({ authorization: await e2e.bearer(userId) });
  const reportKeys = (school: string) => redis.keys(`tenant:${school}:attendance:report:*`);

  async function report(
    userId: string,
    query: { period: ReportPeriod; date: string; groupBy: ReportGrouping },
    expected = 200,
  ): Promise<Report> {
    const response = await request(e2e.server())
      .get('/api/v1/attendance/reports')
      .query(query)
      .set(await as(userId))
      .expect(expected);

    return (response.body as { data: Report }).data;
  }

  const WEEKLY_BY_CLASS = {
    period: ReportPeriod.Weekly,
    date: WEEK_DAY,
    groupBy: ReportGrouping.Class,
  };

  // -------------------------------------------------------------------------
  // What a report says
  // -------------------------------------------------------------------------

  describe('what a report says', () => {
    it('counts each status for the class over the ISO week, with the rate', async () => {
      const body = await report(users.adminA, WEEKLY_BY_CLASS);

      expect(body.period).toEqual({ kind: 'WEEKLY', from: '2026-09-14', to: '2026-09-20' });
      expect(body.rows).toEqual([
        {
          group: { id: a.classA, label: 'JSS 2 A' },
          present: 3,
          absent: 1,
          late: 1,
          excused: 0,
          sick: 1,
          leave: 0,
          total: 6,
          // (3 present + 1 late) / 6 recorded.
          rate: 0.6667,
        },
      ]);
    });

    it('lists only the pupils with records, never one nobody marked', async () => {
      const body = await report(users.adminA, {
        ...WEEKLY_BY_CLASS,
        groupBy: ReportGrouping.Student,
      });

      expect(body.rows.map((row) => row.group.id).sort()).toEqual([a.childStudent, a.pupil].sort());
      expect(body.rows.map((row) => row.group.id)).not.toContain(a.unmarked);
    });

    it("gives a parent their child's figures and nobody else's", async () => {
      const body = await report(users.parentA, {
        ...WEEKLY_BY_CLASS,
        groupBy: ReportGrouping.Student,
      });

      expect(body.rows).toHaveLength(1);
      expect(body.rows[0]).toMatchObject({
        group: { id: a.childStudent },
        present: 1,
        late: 1,
        absent: 1,
        total: 3,
      });
    });

    it('resolves a term by its dates in any session, including one already over', async () => {
      const body = await report(users.adminA, {
        period: ReportPeriod.Term,
        date: '2026-02-11',
        groupBy: ReportGrouping.Role,
      });

      expect(body.period).toEqual({
        kind: 'TERM',
        from: '2026-01-05',
        to: '2026-04-10',
        label: 'Second Term',
      });
      expect(body.rows).toEqual([]);
    });

    it('resolves the session containing the date', async () => {
      const body = await report(users.adminA, {
        period: ReportPeriod.Session,
        date: WEEK_DAY,
        groupBy: ReportGrouping.Role,
      });

      expect(body.period).toMatchObject({ kind: 'SESSION', from: '2026-09-01', to: '2027-07-31' });
      expect(body.rows).toEqual([
        expect.objectContaining({ group: { id: 'STUDENT', label: 'STUDENT' }, total: 6 }),
      ]);
    });

    it('refuses a date in no term, as marking does', async () => {
      const response = await request(e2e.server())
        .get('/api/v1/attendance/reports')
        .query({ period: ReportPeriod.Term, date: '2026-08-10', groupBy: ReportGrouping.Role })
        .set(await as(users.adminA))
        .expect(422);

      expect((response.body as { details: string[] }).details).toEqual([
        NO_PERIOD_COVERS_DATE(ReportPeriod.Term),
      ]);
    });

    // Every period, not only the calendar ones. TERM and SESSION are looked up in
    // Postgres by date, and a date that does not exist must be refused before
    // that lookup, with the same answer the calendar periods give.
    it.each(Object.values(ReportPeriod))(
      'refuses a %s report for a date that is not on the calendar, with the same 422',
      async (period) => {
        const response = await request(e2e.server())
          .get('/api/v1/attendance/reports')
          .query({ period, date: '2026-02-30', groupBy: ReportGrouping.Role })
          .set(await as(users.adminA))
          .expect(422);

        expect(response.body).toMatchObject({
          code: 'VALIDATION_ERROR',
          details: ['2026-02-30 is not a real calendar date.'],
        });
      },
    );
  });

  // -------------------------------------------------------------------------
  // What Redis holds
  // -------------------------------------------------------------------------

  describe('what Redis holds', () => {
    it("caches an administrator's whole-school report under that school's key", async () => {
      await report(users.adminA, WEEKLY_BY_CLASS);

      expect(await reportKeys(A)).toEqual([
        `tenant:${A}:${reportKey(0, { kind: ReportPeriod.Weekly, from: '2026-09-14', to: '2026-09-20' }, ReportGrouping.Class).join(':')}`,
      ]);
    });

    it("never writes a narrowed report to Redis, a teacher's or a parent's", async () => {
      await report(users.teacherA, WEEKLY_BY_CLASS);
      await report(users.parentA, { ...WEEKLY_BY_CLASS, groupBy: ReportGrouping.Student });

      expect(await reportKeys(A)).toEqual([]);
    });

    it('gives two schools asking the identical question their own answers and keys', async () => {
      const ours = await report(users.adminA, WEEKLY_BY_CLASS);
      const theirs = await report(users.adminB, WEEKLY_BY_CLASS);

      expect(ours.rows[0]?.total).toBe(6);
      expect(theirs.rows[0]?.total).toBe(1);
      expect(await reportKeys(A)).toHaveLength(1);
      expect(await reportKeys(B)).toHaveLength(1);
    });

    it('serves the second identical request from the cache', async () => {
      await report(users.adminA, WEEKLY_BY_CLASS);

      // Change a figure behind the cache's back, as the owner, without going
      // through the service. A cached answer does not see it; that proves the
      // second answer came from Redis and not from Postgres.
      await e2e.owner.query(
        `INSERT INTO attendance (tenant_id, attendance_type, date, status, marked_by, student_id,
                                 enrolment_id, class_id, session_id, term_id)
         SELECT tenant_id, attendance_type, '2026-09-17', 'PRESENT', marked_by, student_id,
                enrolment_id, class_id, session_id, term_id
           FROM attendance WHERE student_id = $1 AND date = '2026-09-14'`,
        [a.pupil],
      );

      const second = await report(users.adminA, WEEKLY_BY_CLASS);

      expect(second.rows[0]?.total).toBe(6);

      await e2e.owner.query(
        `DELETE FROM attendance WHERE student_id = $1 AND date = '2026-09-17'`,
        [a.pupil],
      );
    });

    it('shows a register taken through the API in the next administrator report', async () => {
      const before = await report(users.adminA, WEEKLY_BY_CLASS);

      await request(e2e.server())
        .post(`/api/v1/classes/${a.classA}/attendance`)
        .set(await as(users.teacherA))
        .send({ date: '2026-09-17', entries: [{ studentId: a.unmarked, status: 'PRESENT' }] })
        .expect(201);

      const after = await report(users.adminA, WEEKLY_BY_CLASS);

      expect(after.rows[0].total).toBe(before.rows[0].total + 1);
      expect(await redis.get(`tenant:${A}:attendance:generation`)).toBe('1');
    });
  });

  // -------------------------------------------------------------------------
  // The race the generation counter exists to close
  // -------------------------------------------------------------------------

  describe('a slow reader racing a write', () => {
    it('cannot put a stale answer back where the next reader will find it', async () => {
      const week = { kind: ReportPeriod.Weekly, from: '2026-09-14', to: '2026-09-20' };

      // 1. The slow reader reads the generation, then computes from Postgres.
      const generation = Number((await redis.get(`tenant:${A}:attendance:generation`)) ?? 0);
      const stale = await report(users.adminA, WEEKLY_BY_CLASS);

      // 2. Meanwhile a correction commits, and the school moves on a generation.
      const [record] = await e2e.owner.query<Array<{ id: string }>>(
        `SELECT id FROM attendance WHERE student_id = $1 AND date = '2026-09-16'`,
        [a.childStudent],
      );
      await request(e2e.server())
        .post(`/api/v1/attendance/${record.id}/corrections`)
        .set(await as(users.adminA))
        .send({ status: 'PRESENT', reason: 'Arrived after registration closed.' })
        .expect(201);

      // 3. The slow reader finally writes its stale answer, under the generation
      //    it read before the write. Exactly what a real slow reader would do.
      await redis.set(
        `tenant:${A}:${reportKey(generation, week, ReportGrouping.Class).join(':')}`,
        JSON.stringify(stale),
        'EX',
        300,
      );

      // 4. The next reader must see the correction, not the stale answer.
      const fresh = await report(users.adminA, WEEKLY_BY_CLASS);

      expect(fresh.rows[0].absent).toBe(stale.rows[0].absent - 1);
      expect(fresh.rows[0].present).toBe(stale.rows[0].present + 1);
    });
  });
});
