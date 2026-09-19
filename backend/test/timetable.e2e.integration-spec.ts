// Must come first: it sets the database connection before the app loads.
import { type E2eHarness, request, startE2e } from './e2e.harness';

import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { DataSource } from 'typeorm';

import { Role } from '../src/auth/permission.matrix';
import { collectRoutes } from '../src/common/testing/route-inventory';
import { NO_CURRENT_SESSION, PERIOD_IN_ANOTHER_SESSION } from '../src/timetable/timetable.service';
import { seedMember, seedRoleRow } from './people.fixtures';
import {
  enrol,
  register,
  seedClass,
  seedClassSubject,
  seedLesson,
  seedPeriod,
  seedSession,
  seedSubject,
} from './timetable.fixtures';

/**
 * Timetables over HTTP: every route attacked from another school, whose week each
 * caller gets back from `GET /me/timetable`, and the clash messages an
 * administrator sees when a slot is taken.
 *
 * The clash rules themselves are proved at the database, as raw SQL, in
 * `timetable-constraints.integration-spec.ts`. This suite proves what a client
 * sees of them: that each is a 409 naming what is in the way, that the allowed
 * cases are allowed through the API too, and that reassigning a class subject
 * moves its lessons or changes nothing at all.
 */
describe('timetables end to end', () => {
  let e2e: E2eHarness;

  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const users = {
    admin: '90000000-0000-4000-8000-000000000001',
    adaeze: '90000000-0000-4000-8000-000000000002',
    obi: '90000000-0000-4000-8000-000000000003',
    zainab: '90000000-0000-4000-8000-000000000004',
    zainabParent: '90000000-0000-4000-8000-000000000005',
    staff: '90000000-0000-4000-8000-000000000006',
    adminB: '90000000-0000-4000-8000-000000000011',
  } as const;

  /** Ids in school A, set during seeding. */
  const a = {} as Record<
    | 'session'
    | 'lastSession'
    | 'jss2a'
    | 'jss2b'
    | 'adaeze'
    | 'obi'
    | 'chidi'
    | 'ngozi'
    | 'zainab'
    | 'aMaths'
    | 'aEnglish'
    | 'aFrench'
    | 'aArabic'
    | 'bMaths'
    | 'bEnglish'
    | 'tueP1'
    | 'tueP2'
    | 'tueP3'
    | 'wedP1'
    | 'wedP2'
    | 'friP9'
    | 'lastYearP1',
    string
  >;

  /** Lessons in school A, by class subject, seeded before any test runs. */
  const lesson = {} as Record<
    | 'aMaths'
    | 'aEnglish'
    | 'aFrench'
    | 'aArabic'
    | 'bMaths'
    | 'bEnglish'
    | 'bSpanish'
    | 'lastYearMaths',
    string
  >;

  /** Ids in school B: every kind of record the sweep aims at. */
  const b = {} as Record<
    'session' | 'class' | 'teacher' | 'classSubject' | 'period' | 'lesson',
    string
  >;

  async function name(owner: DataSource, table: string, id: string, first: string, last: string) {
    await owner.query(`UPDATE ${table} SET first_name = $2, last_name = $3 WHERE id = $1`, [
      id,
      first,
      last,
    ]);
  }

  beforeAll(async () => {
    e2e = await startE2e(
      async (owner) => {
        await owner.query(
          `INSERT INTO tenants (id, name, slug) VALUES
           ($1, 'Greenfield', 'greenfield'), ($2, 'Brookvale', 'brookvale')`,
          [A, B],
        );

        // ---------------------------------------------------------------- people
        await seedMember(owner, A, users.admin, [Role.SchoolAdmin]);
        a.adaeze = (await seedMember(owner, A, users.adaeze, [Role.Teacher])).roleRows[
          Role.Teacher
        ]!;
        // A teacher whose own child is a pupil here.
        const obi = await seedMember(owner, A, users.obi, [Role.Teacher, Role.Parent]);
        a.obi = obi.roleRows[Role.Teacher]!;
        a.zainab = (await seedMember(owner, A, users.zainab, [Role.Student])).roleRows[
          Role.Student
        ]!;
        const parent = await seedMember(owner, A, users.zainabParent, [Role.Parent]);
        await seedMember(owner, A, users.staff, [Role.Staff]);
        a.chidi = await seedRoleRow(owner, A, Role.Teacher, null);
        a.ngozi = await seedRoleRow(owner, A, Role.Teacher, null);
        const kemi = await seedRoleRow(owner, A, Role.Student, null);
        const tunde = await seedRoleRow(owner, A, Role.Student, null);

        await name(owner, 'teachers', a.adaeze, 'Adaeze', 'Okonkwo');
        await name(owner, 'teachers', a.obi, 'Obi', 'Nwosu');
        await name(owner, 'teachers', a.chidi, 'Chidi', 'Eze');
        await name(owner, 'teachers', a.ngozi, 'Ngozi', 'Bello');
        await name(owner, 'students', a.zainab, 'Zainab', 'Bello');
        await name(owner, 'students', kemi, 'Kemi', 'Adeyemi');
        await name(owner, 'students', tunde, 'Tunde', 'Nwosu');

        await owner.query(
          `INSERT INTO guardianships (tenant_id, parent_id, student_id) VALUES ($1, $2, $3), ($1, $4, $5)`,
          [A, parent.roleRows[Role.Parent], a.zainab, obi.roleRows[Role.Parent], tunde],
        );

        // ------------------------------------------------------------- structure
        a.session = await seedSession(owner, A, {
          name: '2026/2027',
          startsOn: '2026-09-01',
          endsOn: '2027-07-31',
          current: true,
        });
        a.lastSession = await seedSession(owner, A, {
          name: '2025/2026',
          startsOn: '2025-09-01',
          endsOn: '2026-07-31',
          current: false,
        });
        a.jss2a = await seedClass(owner, A, a.session, 'JSS 2', 'A');
        a.jss2b = await seedClass(owner, A, a.session, 'JSS 2', 'B');
        const lastYearClass = await seedClass(owner, A, a.lastSession, 'JSS 1', 'A');

        const subject = (title: string) => seedSubject(owner, A, title);
        const [maths, english, french, arabic, spanish] = await Promise.all(
          ['Mathematics', 'English', 'French', 'Arabic', 'Spanish'].map(subject),
        );
        const assign = (classId: string, subjectId: string, teacherId: string, elective = false) =>
          seedClassSubject(owner, A, { classId, subjectId, teacherId, elective });
        a.aMaths = await assign(a.jss2a, maths, a.adaeze);
        a.aEnglish = await assign(a.jss2a, english, a.obi);
        a.aFrench = await assign(a.jss2a, french, a.chidi, true);
        a.aArabic = await assign(a.jss2a, arabic, a.ngozi, true);
        a.bMaths = await assign(a.jss2b, maths, a.adaeze);
        a.bEnglish = await assign(a.jss2b, english, a.obi);
        const bSpanish = await assign(a.jss2b, spanish, a.ngozi, true);
        const lastYearMaths = await assign(lastYearClass, maths, a.adaeze);

        const period = (weekday: number, label: string, startsAt: string, endsAt: string) =>
          seedPeriod(owner, A, { sessionId: a.session, weekday, label, startsAt, endsAt });
        a.tueP1 = await period(2, 'P1', '08:00', '08:40');
        a.tueP2 = await period(2, 'P2', '08:40', '09:20');
        a.tueP3 = await period(2, 'P3', '09:20', '10:00');
        a.wedP1 = await period(3, 'P1', '08:00', '08:40');
        a.wedP2 = await period(3, 'P2', '08:40', '09:20');
        a.friP9 = await period(5, 'P9', '14:00', '14:40');
        a.lastYearP1 = await seedPeriod(owner, A, {
          sessionId: a.lastSession,
          weekday: 2,
          label: 'P1',
          startsAt: '08:00',
          endsAt: '08:40',
        });

        // -------------------------------------------------------------- pupils
        // Zainab: JSS 2 A, takes French. Last year she was in JSS 1 A.
        await enrol(owner, A, { classId: a.jss2a, studentId: a.zainab });
        await enrol(owner, A, { classId: lastYearClass, studentId: a.zainab });
        await register(owner, A, { classSubjectId: a.aFrench, studentId: a.zainab });
        // A registration for an elective in another class, left behind. It must
        // show her nothing: the service refuses to create one, so it is seeded raw.
        await register(owner, A, { classSubjectId: bSpanish, studentId: a.zainab });
        // Kemi: JSS 2 A, registered for both electives that run in Tuesday P3.
        await enrol(owner, A, { classId: a.jss2a, studentId: kemi });
        await register(owner, A, { classSubjectId: a.aFrench, studentId: kemi });
        await register(owner, A, { classSubjectId: a.aArabic, studentId: kemi });
        // Tunde: JSS 2 B, Obi's son, takes no elective.
        await enrol(owner, A, { classId: a.jss2b, studentId: tunde });

        // ------------------------------------------------------------- lessons
        const place = (periodId: string, classSubjectId: string) =>
          seedLesson(owner, A, { periodId, classSubjectId });
        lesson.aMaths = await place(a.tueP1, a.aMaths);
        lesson.aEnglish = await place(a.tueP2, a.aEnglish);
        lesson.aFrench = await place(a.tueP3, a.aFrench);
        lesson.aArabic = await place(a.tueP3, a.aArabic);
        lesson.bMaths = await place(a.tueP2, a.bMaths);
        lesson.bEnglish = await place(a.wedP1, a.bEnglish);
        lesson.bSpanish = await place(a.wedP2, bSpanish);
        lesson.lastYearMaths = await place(a.lastYearP1, lastYearMaths);

        // -------------------------------------------------------------- school B
        // Its only session is not current, so its administrator also shows what a
        // school with no current session gets.
        await seedMember(owner, B, users.adminB, [Role.SchoolAdmin]);
        b.session = await seedSession(owner, B, {
          name: '2026/2027',
          startsOn: '2026-09-01',
          endsOn: '2027-07-31',
          current: false,
        });
        b.class = await seedClass(owner, B, b.session, 'JSS 2', 'A');
        b.teacher = await seedRoleRow(owner, B, Role.Teacher, null);
        const bSubject = await seedSubject(owner, B, 'Mathematics');
        b.classSubject = await seedClassSubject(owner, B, {
          classId: b.class,
          subjectId: bSubject,
          teacherId: b.teacher,
        });
        b.period = await seedPeriod(owner, B, {
          sessionId: b.session,
          weekday: 2,
          label: 'P1',
          startsAt: '08:00',
          endsAt: '08:40',
        });
        b.lesson = await seedLesson(owner, B, {
          periodId: b.period,
          classSubjectId: b.classSubject,
        });
      },
      [DiscoveryModule],
    );
  }, 180_000);

  afterAll(async () => {
    await e2e?.close();
  });

  const as = async (userId: string) => ({ authorization: await e2e.bearer(userId) });

  interface Lesson {
    id: string;
    period: { id: string; weekday: number; weekdayName: string; label: string };
    class: { name: string };
    subject: { name: string };
    teacher: { id: string; name: string };
    isElective: boolean;
  }

  const data = <T>(response: { body: unknown }) => (response.body as { data: T }).data;
  const details = (response: { body: unknown }) =>
    (response.body as { details?: string[] }).details;
  const message = (response: { body: unknown }) => (response.body as { message: string }).message;

  async function get<T>(path: string, userId: string, expected = 200): Promise<T> {
    const response = await request(e2e.server())
      .get(`/api/v1${path}`)
      .set(await as(userId))
      .expect(expected);

    return data<T>(response);
  }

  const ids = (lessons: Lesson[]) => lessons.map((row) => row.id).sort();

  /** A live row in school B, read as the owner. */
  async function liveInB(table: string, id: string): Promise<boolean> {
    const rows = await e2e.owner.query<unknown[]>(
      `SELECT 1 FROM ${table} WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, B],
    );
    return rows.length === 1;
  }

  // -------------------------------------------------------------------------
  // The cross-school sweep
  // -------------------------------------------------------------------------

  describe("every timetable route, attacked with another school's ids", () => {
    const TIMETABLE_CONTROLLERS = new Set(['TimetableController', 'MyTimetableController']);

    const CASES: Record<string, () => Promise<void>> = {
      'GET /timetable/periods': async () => {
        await get(`/timetable/periods?sessionId=${b.session}`, users.admin, 404);
        const periods = await get<Array<{ id: string }>>('/timetable/periods', users.admin);
        expect(periods.map((row) => row.id)).not.toContain(b.period);
      },
      'POST /timetable/periods': async () => {
        await request(e2e.server())
          .post('/api/v1/timetable/periods')
          .set(await as(users.admin))
          .send({
            sessionId: b.session,
            weekday: 4,
            label: 'Z9',
            startsAt: '15:00',
            endsAt: '15:40',
          })
          .expect(404);
        const [row] = await e2e.owner.query<Array<{ count: string }>>(
          `SELECT count(*) AS count FROM timetable_periods WHERE label = 'Z9'`,
        );
        expect(Number(row.count)).toBe(0);
      },
      'PATCH /timetable/periods/:id': async () => {
        await request(e2e.server())
          .patch(`/api/v1/timetable/periods/${b.period}`)
          .set(await as(users.admin))
          .send({ label: 'Hijacked' })
          .expect(404);
        const [row] = await e2e.owner.query<Array<{ label: string }>>(
          `SELECT label FROM timetable_periods WHERE id = $1`,
          [b.period],
        );
        expect(row.label).toBe('P1');
      },
      'DELETE /timetable/periods/:id': async () => {
        await request(e2e.server())
          .delete(`/api/v1/timetable/periods/${b.period}`)
          .set(await as(users.admin))
          .expect(404);
        expect(await liveInB('timetable_periods', b.period)).toBe(true);
      },
      'POST /timetable/lessons': async () => {
        // Their period with our subject, and our period with their subject.
        await request(e2e.server())
          .post('/api/v1/timetable/lessons')
          .set(await as(users.admin))
          .send({ periodId: b.period, classSubjectId: a.aMaths })
          .expect(404);
        await request(e2e.server())
          .post('/api/v1/timetable/lessons')
          .set(await as(users.admin))
          .send({ periodId: a.friP9, classSubjectId: b.classSubject })
          .expect(404);
      },
      'PATCH /timetable/lessons/:id': async () => {
        // Their lesson into our period, and our lesson into their period.
        await request(e2e.server())
          .patch(`/api/v1/timetable/lessons/${b.lesson}`)
          .set(await as(users.admin))
          .send({ periodId: a.friP9 })
          .expect(404);
        await request(e2e.server())
          .patch(`/api/v1/timetable/lessons/${lesson.bSpanish}`)
          .set(await as(users.admin))
          .send({ periodId: b.period })
          .expect(404);
        const [row] = await e2e.owner.query<Array<{ period_id: string }>>(
          `SELECT period_id FROM timetable_lessons WHERE id = $1`,
          [b.lesson],
        );
        expect(row.period_id).toBe(b.period);
      },
      'DELETE /timetable/lessons/:id': async () => {
        await request(e2e.server())
          .delete(`/api/v1/timetable/lessons/${b.lesson}`)
          .set(await as(users.admin))
          .expect(404);
        expect(await liveInB('timetable_lessons', b.lesson)).toBe(true);
      },
      'GET /timetable/classes/:classId': async () => {
        await get(`/timetable/classes/${b.class}`, users.admin, 404);
      },
      'GET /timetable/teachers/:teacherId': async () => {
        await get(`/timetable/teachers/${b.teacher}`, users.admin, 404);
        await get(`/timetable/teachers/${a.adaeze}?sessionId=${b.session}`, users.admin, 404);
      },
      'GET /timetable/conflicts': async () => {
        await get(`/timetable/conflicts?sessionId=${b.session}`, users.admin, 404);
      },
      'GET /me/timetable': async () => {
        const mine = await get<Lesson[]>('/me/timetable', users.adaeze);
        expect(ids(mine)).not.toContain(b.lesson);
      },
    };

    it('has a case for every timetable route, and none for a route that is gone', () => {
      const routes = collectRoutes(
        e2e.app.get(DiscoveryService),
        e2e.app.get(MetadataScanner),
        e2e.app.get(Reflector),
      )
        .filter((route) => TIMETABLE_CONTROLLERS.has(route.controller))
        .map((route) => `${route.method} ${route.path}`)
        .sort();

      expect(routes.length).toBeGreaterThan(0);
      expect(routes).toEqual(Object.keys(CASES).sort());
    });

    it.each(Object.keys(CASES).sort())('%s', async (signature) => {
      await CASES[signature]();
    });

    it('refuses reassigning a class subject across schools, in both directions', async () => {
      // The new route on the academics side: their subject to our teacher, and
      // our subject to their teacher.
      await request(e2e.server())
        .patch(`/api/v1/class-subjects/${b.classSubject}`)
        .set(await as(users.admin))
        .send({ teacherId: a.chidi })
        .expect(404);
      await request(e2e.server())
        .patch(`/api/v1/class-subjects/${a.bEnglish}`)
        .set(await as(users.admin))
        .send({ teacherId: b.teacher })
        .expect(404);
      const [row] = await e2e.owner.query<Array<{ teacher_id: string }>>(
        `SELECT teacher_id FROM class_subjects WHERE id = $1`,
        [a.bEnglish],
      );
      expect(row.teacher_id).toBe(a.obi);
    });
  });

  // -------------------------------------------------------------------------
  // Whose week GET /me/timetable returns
  // -------------------------------------------------------------------------

  describe('GET /me/timetable, caller by lesson', () => {
    /**
     * Every cell stated. The near misses are the point: the elective in her own
     * class Zainab did not take, the elective in another class she has a stray
     * registration for, and last year's lesson in her old class.
     */
    const cases: Array<[string, keyof typeof users, Array<keyof typeof lesson>]> = [
      [
        'a pupil: her core lessons and the elective she took',
        'zainab',
        ['aMaths', 'aEnglish', 'aFrench'],
      ],
      ["a parent: their child's week, exactly", 'zainabParent', ['aMaths', 'aEnglish', 'aFrench']],
      ['a teacher: what they teach this session, not last year', 'adaeze', ['aMaths', 'bMaths']],
      [
        "a teacher who is a parent: what they teach, and their son's core lessons",
        'obi',
        ['aEnglish', 'bEnglish', 'bMaths'],
      ],
      ['a member of staff: nothing', 'staff', []],
      ['an administrator: nothing of their own; the school is on the other routes', 'admin', []],
    ];

    it.each(cases)('%s', async (_title, user, expected) => {
      const mine = await get<Lesson[]>('/me/timetable', users[user]);

      expect(ids(mine)).toEqual(expected.map((key) => lesson[key]).sort());
    });

    it('gives a school with no current session an empty week, not an error', async () => {
      await expect(get<Lesson[]>('/me/timetable', users.adminB)).resolves.toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  describe('reading a week', () => {
    it("returns a class's week in order, with the names a reader shows", async () => {
      const week = await get<Lesson[]>(`/timetable/classes/${a.jss2a}`, users.zainab);

      expect(
        week.map((row) => [
          row.period.weekdayName,
          row.period.label,
          row.subject.name,
          row.teacher.name,
        ]),
      ).toEqual([
        ['Tuesday', 'P1', 'Mathematics', 'Adaeze Okonkwo'],
        ['Tuesday', 'P2', 'English', 'Obi Nwosu'],
        ['Tuesday', 'P3', 'Arabic', 'Ngozi Bello'],
        ['Tuesday', 'P3', 'French', 'Chidi Eze'],
      ]);
      expect(week.every((row) => row.class.name === 'JSS 2 A')).toBe(true);
      expect(week.filter((row) => row.isElective).map((row) => row.subject.name)).toEqual([
        'Arabic',
        'French',
      ]);
    });

    it("returns a teacher's week across classes, this session by default", async () => {
      const week = await get<Lesson[]>(`/timetable/teachers/${a.adaeze}`, users.staff);

      expect(week.map((row) => `${row.period.label} ${row.class.name}`)).toEqual([
        'P1 JSS 2 A',
        'P2 JSS 2 B',
      ]);
    });

    it("returns a teacher's week in a past session when asked", async () => {
      const week = await get<Lesson[]>(
        `/timetable/teachers/${a.adaeze}?sessionId=${a.lastSession}`,
        users.admin,
      );

      expect(ids(week)).toEqual([lesson.lastYearMaths]);
    });

    it('lists the periods of the current session by weekday and time', async () => {
      const periods = await get<Array<{ weekdayName: string; label: string; startsAt: string }>>(
        '/timetable/periods',
        users.adaeze,
      );

      expect(periods.map((row) => `${row.weekdayName} ${row.label} ${row.startsAt}`)).toEqual([
        'Tuesday P1 08:00',
        'Tuesday P2 08:40',
        'Tuesday P3 09:20',
        'Wednesday P1 08:00',
        'Wednesday P2 08:40',
        'Friday P9 14:00',
      ]);
    });

    it('refuses a session-wide read when the school has no current session and none is named', async () => {
      const response = await request(e2e.server())
        .get('/api/v1/timetable/periods')
        .set(await as(users.adminB))
        .expect(422);

      expect(details(response)).toEqual([NO_CURRENT_SESSION]);
    });

    it('reports the pupil registered for two electives running at once', async () => {
      const conflicts = await get<
        Array<{
          student: { name: string };
          class: { name: string };
          period: { weekdayName: string; label: string };
          lessons: Array<{ id: string; subject: { name: string } }>;
        }>
      >('/timetable/conflicts', users.admin);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        student: { name: 'Kemi Adeyemi' },
        class: { name: 'JSS 2 A' },
        period: { weekdayName: 'Tuesday', label: 'P3' },
      });
      expect(conflicts[0].lessons.map((row) => [row.id, row.subject.name])).toEqual([
        [lesson.aArabic, 'Arabic'],
        [lesson.aFrench, 'French'],
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Who may do what
  // -------------------------------------------------------------------------

  describe('permissions', () => {
    it('lets every member read a class or teacher week', async () => {
      await get(`/timetable/classes/${a.jss2b}`, users.adaeze);
      await get(`/timetable/teachers/${a.obi}`, users.zainabParent);
    });

    it('keeps timetable writes to the administrator', async () => {
      await request(e2e.server())
        .post('/api/v1/timetable/lessons')
        .set(await as(users.adaeze))
        .send({ periodId: a.friP9, classSubjectId: a.aMaths })
        .expect(403);
      await request(e2e.server())
        .patch(`/api/v1/class-subjects/${a.aMaths}`)
        .set(await as(users.adaeze))
        .send({ teacherId: a.obi })
        .expect(403);
    });

    it('keeps the conflicts report to the administrator', async () => {
      await get('/timetable/conflicts', users.staff, 403);
    });
  });

  // -------------------------------------------------------------------------
  // Writes. Last, since they change the week the tests above read.
  // -------------------------------------------------------------------------

  describe('shaping the week', () => {
    const post = async (path: string, body: object, expected: number) =>
      request(e2e.server())
        .post(`/api/v1${path}`)
        .set(await as(users.admin))
        .send(body)
        .expect(expected);

    const patch = async (path: string, body: object, expected: number) =>
      request(e2e.server())
        .patch(`/api/v1${path}`)
        .set(await as(users.admin))
        .send(body)
        .expect(expected);

    const remove = async (path: string, expected: number) =>
      request(e2e.server())
        .delete(`/api/v1${path}`)
        .set(await as(users.admin))
        .expect(expected);

    const thursday = (label: string, startsAt: string, endsAt: string) => ({
      sessionId: a.session,
      weekday: 4,
      label,
      startsAt,
      endsAt,
    });

    const t = {} as Record<'p1' | 'p2' | 'p3' | 'maths', string>;

    describe('periods', () => {
      it('adds a period and names its day', async () => {
        const response = await post('/timetable/periods', thursday('P1', '08:00', '08:40'), 201);

        expect(data(response)).toMatchObject({
          weekday: 4,
          weekdayName: 'Thursday',
          label: 'P1',
          startsAt: '08:00',
          endsAt: '08:40',
        });
        t.p1 = data<{ id: string }>(response).id;
        t.p2 = data<{ id: string }>(
          await post('/timetable/periods', thursday('P2', '08:40', '09:20'), 201),
        ).id;
        t.p3 = data<{ id: string }>(
          await post('/timetable/periods', thursday('P3', '09:20', '10:00'), 201),
        ).id;
      });

      it('names the period in the way of an overlapping one', async () => {
        const response = await post('/timetable/periods', thursday('Quiz', '08:20', '08:50'), 409);

        expect(message(response)).toBe(
          'Thursday P1 (08:00 to 08:40) already covers part of that time.',
        );
      });

      it('refuses a label already used that day, in any case', async () => {
        const response = await post('/timetable/periods', thursday('p1', '13:00', '13:40'), 409);

        expect(message(response)).toBe('Thursday already has a period called P1.');
      });

      it('refuses a period that ends before it starts', async () => {
        await post('/timetable/periods', thursday('P8', '13:40', '13:00'), 422);
      });

      it.each([
        ['a time without its leading zero', { startsAt: '8:00' }],
        ['a weekday past Sunday', { weekday: 8 }],
        ['an empty label', { label: '' }],
      ])('refuses %s at the door', async (_title, change) => {
        await post('/timetable/periods', { ...thursday('P7', '12:00', '12:40'), ...change }, 400);
      });

      it('moves a period in place, keeping others out of its way', async () => {
        const response = await patch(
          `/timetable/periods/${a.friP9}`,
          { startsAt: '14:10', endsAt: '14:50' },
          200,
        );

        expect(data(response)).toMatchObject({ label: 'P9', startsAt: '14:10', endsAt: '14:50' });
        await patch(
          `/timetable/periods/${a.friP9}`,
          { weekday: 2, startsAt: '09:00', endsAt: '09:30' },
          409,
        );
      });
    });

    describe('lessons', () => {
      it('places a class subject and returns the lesson as a reader sees it', async () => {
        const response = await post(
          '/timetable/lessons',
          { periodId: t.p1, classSubjectId: a.aMaths },
          201,
        );

        expect(data(response)).toMatchObject({
          period: { weekdayName: 'Thursday', label: 'P1', startsAt: '08:00', endsAt: '08:40' },
          class: { name: 'JSS 2 A' },
          subject: { name: 'Mathematics' },
          teacher: { name: 'Adaeze Okonkwo' },
          classSubjectId: a.aMaths,
          isElective: false,
        });
        t.maths = data<{ id: string }>(response).id;
      });

      it.each([
        [
          'a second core lesson for the class',
          () => a.aEnglish,
          'JSS 2 A already has Mathematics in Thursday P1.',
        ],
        [
          'the same teacher in another class',
          () => a.bMaths,
          'Adaeze Okonkwo already teaches JSS 2 A in Thursday P1.',
        ],
        [
          'an elective beside the core lesson',
          () => a.aFrench,
          'JSS 2 A already has Mathematics in Thursday P1, and an elective cannot share a period with a core lesson.',
        ],
      ])('names the clash for %s', async (_title, classSubject, expected) => {
        const response = await post(
          '/timetable/lessons',
          { periodId: t.p1, classSubjectId: classSubject() },
          409,
        );

        expect(message(response)).toBe(expected);
      });

      it('runs two electives side by side, and keeps a core lesson out of them', async () => {
        await post('/timetable/lessons', { periodId: t.p2, classSubjectId: a.aFrench }, 201);
        await post('/timetable/lessons', { periodId: t.p2, classSubjectId: a.aArabic }, 201);

        const response = await post(
          '/timetable/lessons',
          { periodId: t.p2, classSubjectId: a.aEnglish },
          409,
        );

        expect(message(response)).toBe(
          'JSS 2 A already has Arabic, an elective, in Thursday P2, and a core lesson cannot share a period with electives.',
        );
      });

      it('refuses a period from another session', async () => {
        const response = await post(
          '/timetable/lessons',
          { periodId: a.lastYearP1, classSubjectId: a.aMaths },
          422,
        );

        expect(details(response)).toEqual([PERIOD_IN_ANOTHER_SESSION]);
      });

      it('moves a lesson to a free period', async () => {
        const response = await patch(`/timetable/lessons/${t.maths}`, { periodId: t.p3 }, 200);

        expect(data<Lesson>(response).period).toMatchObject({ id: t.p3, label: 'P3' });
      });

      it('names the clash when a move would put a core lesson among electives', async () => {
        const response = await patch(`/timetable/lessons/${t.maths}`, { periodId: t.p2 }, 409);

        expect(message(response)).toBe(
          'JSS 2 A already has Arabic, an elective, in Thursday P2, and a core lesson cannot share a period with electives.',
        );
      });

      it('refuses moving a lesson into another session', async () => {
        await patch(`/timetable/lessons/${t.maths}`, { periodId: a.lastYearP1 }, 422);
      });

      it('refuses removing a period that still holds lessons, and removes an empty one', async () => {
        const response = await remove(`/timetable/periods/${t.p2}`, 409);

        expect(message(response)).toBe(
          'Thursday P2 still has 2 lessons. Move or remove them first.',
        );

        await remove(`/timetable/periods/${t.p1}`, 200);
        const periods = await get<Array<{ id: string }>>('/timetable/periods', users.admin);
        expect(periods.map((row) => row.id)).not.toContain(t.p1);
      });

      it('takes a lesson off, once', async () => {
        await remove(`/timetable/lessons/${t.maths}`, 200);
        await remove(`/timetable/lessons/${t.maths}`, 404);
        const week = await get<Lesson[]>(`/timetable/classes/${a.jss2a}`, users.admin);
        expect(ids(week)).not.toContain(t.maths);
      });
    });

    describe('reassigning a class subject', () => {
      async function teacherOf(classSubject: string) {
        const [subject] = await e2e.owner.query<Array<{ teacher_id: string }>>(
          `SELECT teacher_id FROM class_subjects WHERE id = $1`,
          [classSubject],
        );
        const lessons = await e2e.owner.query<Array<{ teacher_id: string }>>(
          `SELECT DISTINCT teacher_id FROM timetable_lessons
            WHERE class_subject_id = $1 AND deleted_at IS NULL`,
          [classSubject],
        );

        return { subject: subject.teacher_id, lessons: lessons.map((row) => row.teacher_id) };
      }

      it('moves its lessons to the new teacher', async () => {
        await patch(`/class-subjects/${a.bEnglish}`, { teacherId: a.chidi }, 200);

        expect(await teacherOf(a.bEnglish)).toEqual({ subject: a.chidi, lessons: [a.chidi] });

        const chidi = await get<Lesson[]>(`/timetable/teachers/${a.chidi}`, users.admin);
        const obi = await get<Lesson[]>(`/timetable/teachers/${a.obi}`, users.admin);
        expect(ids(chidi)).toContain(lesson.bEnglish);
        expect(ids(obi)).not.toContain(lesson.bEnglish);

        await patch(`/class-subjects/${a.bEnglish}`, { teacherId: a.obi }, 200);
      });

      it('names the clash and changes nothing when the new teacher is busy then', async () => {
        const response = await patch(`/class-subjects/${a.aEnglish}`, { teacherId: a.adaeze }, 409);

        expect(message(response)).toBe(
          'Adaeze Okonkwo already teaches JSS 2 B in Tuesday P2, when JSS 2 A English is timetabled.',
        );
        expect(await teacherOf(a.aEnglish)).toEqual({ subject: a.obi, lessons: [a.obi] });
      });

      it('treats reassigning to the same teacher as nothing to do', async () => {
        const response = await patch(`/class-subjects/${a.aEnglish}`, { teacherId: a.obi }, 200);

        expect(data(response)).toMatchObject({ id: a.aEnglish, teacherId: a.obi });
      });
    });
  });
});
