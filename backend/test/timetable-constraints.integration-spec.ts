import { DataSource, type EntityManager } from 'typeorm';

import { Role } from '../src/auth/permission.matrix';
import { APP_ROLE_PASSWORD } from './app-database.env';
import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';
import { seedMember, seedRoleRow } from './people.fixtures';
import {
  seedClass,
  seedClassSubject,
  seedLesson,
  seedPeriod,
  seedSession,
  seedSubject,
} from './timetable.fixtures';

/**
 * The timetable's clash rules, asked of the database directly.
 *
 * Each rule is attempted as `cyberschola_app` with a tenant in session, as a
 * request would run, but as raw SQL: a background job or a hand-written statement
 * never passes through the service's friendly pre-check, and the rule is only
 * real if the database holds it for them too. Every refusal is asserted by the
 * constraint that made it, not only by its SQLSTATE, so a rule refused for the
 * wrong reason does not pass.
 *
 * The cases that must stay allowed are asserted beside the ones that must not:
 * electives running in parallel, back-to-back periods, the same times on another
 * day. A constraint drawn too wide would pass every refusal and fail these.
 *
 * Each case runs in a transaction that is always rolled back, so the cases are
 * independent and can be read in any order.
 */
describe('timetable constraints', () => {
  let owner: DataSource;
  let app: DataSource;

  const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const OTHER_SCHOOL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const ADMIN_USER = '80000000-0000-4000-8000-000000000001';

  /** Ids in the school, set during seeding. */
  const w = {} as Record<
    | 'session'
    | 'lastSession'
    | 'jss2a'
    | 'jss2b'
    | 'lastYearClass'
    | 'adaeze'
    | 'obi'
    | 'chidi'
    | 'ngozi'
    | 'aMaths'
    | 'aEnglish'
    | 'aFrench'
    | 'aArabic'
    | 'bMaths'
    | 'bEnglish'
    | 'tueP1'
    | 'tueP2'
    | 'tueP3'
    | 'lastYearP1'
    | 'otherSchoolClassSubject',
    string
  >;

  /** Why a rolled-back attempt failed, or 'accepted'. */
  type Outcome = 'accepted' | { state: string; constraint: string | undefined };

  class Rollback extends Error {}

  /**
   * Runs `work` as the application role in the school's context, then rolls it
   * back whatever happened, and reports whether the database accepted it.
   */
  async function attempt(work: (manager: EntityManager) => Promise<unknown>): Promise<Outcome> {
    try {
      await app.transaction(async (manager) => {
        await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [SCHOOL]);
        await manager.query(`SELECT set_config('app.current_user', $1, true)`, [ADMIN_USER]);
        await work(manager);
        throw new Rollback();
      });
    } catch (error) {
      if (error instanceof Rollback) {
        return 'accepted';
      }

      const driver = (error as { driverError?: { code?: string; constraint?: string } })
        .driverError;

      if (driver?.code === undefined) {
        throw error;
      }

      return { state: driver.code, constraint: driver.constraint };
    }

    throw new Error('unreachable: the transaction always rolls back');
  }

  /** A lesson, inserted with explicit copies, as a statement that bypasses the service would. */
  function insertLesson(
    manager: EntityManager,
    lesson: {
      period: string;
      classSubject: string;
      classId?: string;
      teacher?: string;
      elective?: boolean;
      session?: string;
    },
  ) {
    return manager.query(
      `INSERT INTO timetable_lessons
         (tenant_id, session_id, period_id, class_id, class_subject_id, teacher_id, is_elective)
       SELECT $1, COALESCE($7::uuid, period.session_id), period.id,
              COALESCE($4::uuid, assignment.class_id), assignment.id,
              COALESCE($5::uuid, assignment.teacher_id),
              COALESCE($6::boolean, assignment.is_elective)
         FROM timetable_periods period, class_subjects assignment
        WHERE period.id = $2 AND assignment.id = $3`,
      [
        SCHOOL,
        lesson.period,
        lesson.classSubject,
        lesson.classId ?? null,
        lesson.teacher ?? null,
        lesson.elective ?? null,
        lesson.session ?? null,
      ],
    );
  }

  /** A lesson that names its copies outright, for rows the join above cannot build. */
  function insertLiteralLesson(
    manager: EntityManager,
    row: {
      session: string;
      period: string;
      classId: string;
      classSubject: string;
      teacher: string;
      elective: boolean;
    },
  ) {
    return manager.query(
      `INSERT INTO timetable_lessons
         (tenant_id, session_id, period_id, class_id, class_subject_id, teacher_id, is_elective)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [SCHOOL, row.session, row.period, row.classId, row.classSubject, row.teacher, row.elective],
    );
  }

  function insertPeriod(
    manager: EntityManager,
    period: { weekday: number; label: string; startsAt: string; endsAt: string },
  ) {
    return manager.query(
      `INSERT INTO timetable_periods (tenant_id, session_id, weekday, label, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [SCHOOL, w.session, period.weekday, period.label, period.startsAt, period.endsAt],
    );
  }

  const refusedBy = (state: string, constraint: string) => ({ state, constraint });

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
      logging: false,
    });
    await app.initialize();

    await owner.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Greenfield', 'greenfield'), ($2, 'Brookvale', 'brookvale')`,
      [SCHOOL, OTHER_SCHOOL],
    );
    await seedMember(owner, SCHOOL, ADMIN_USER, [Role.SchoolAdmin]);

    w.session = await seedSession(owner, SCHOOL, {
      name: '2026/2027',
      startsOn: '2026-09-01',
      endsOn: '2027-07-31',
      current: true,
    });
    w.lastSession = await seedSession(owner, SCHOOL, {
      name: '2025/2026',
      startsOn: '2025-09-01',
      endsOn: '2026-07-31',
      current: false,
    });

    w.jss2a = await seedClass(owner, SCHOOL, w.session, 'JSS 2', 'A');
    w.jss2b = await seedClass(owner, SCHOOL, w.session, 'JSS 2', 'B');
    w.lastYearClass = await seedClass(owner, SCHOOL, w.lastSession, 'JSS 1', 'A');

    const teacher = (firstName: string) =>
      seedRoleRow(owner, SCHOOL, Role.Teacher, null, { firstName });
    w.adaeze = await teacher('Adaeze');
    w.obi = await teacher('Obi');
    w.chidi = await teacher('Chidi');
    w.ngozi = await teacher('Ngozi');

    const maths = await seedSubject(owner, SCHOOL, 'Mathematics');
    const english = await seedSubject(owner, SCHOOL, 'English');
    const french = await seedSubject(owner, SCHOOL, 'French');
    const arabic = await seedSubject(owner, SCHOOL, 'Arabic');

    const assign = (classId: string, subjectId: string, teacherId: string, elective = false) =>
      seedClassSubject(owner, SCHOOL, { classId, subjectId, teacherId, elective });
    w.aMaths = await assign(w.jss2a, maths, w.adaeze);
    w.aEnglish = await assign(w.jss2a, english, w.obi);
    w.aFrench = await assign(w.jss2a, french, w.chidi, true);
    w.aArabic = await assign(w.jss2a, arabic, w.ngozi, true);
    w.bMaths = await assign(w.jss2b, maths, w.adaeze);
    w.bEnglish = await assign(w.jss2b, english, w.obi);

    const period = (label: string, startsAt: string, endsAt: string, sessionId = w.session) =>
      seedPeriod(owner, SCHOOL, { sessionId, weekday: 2, label, startsAt, endsAt });
    w.tueP1 = await period('P1', '08:00', '08:40');
    w.tueP2 = await period('P2', '08:40', '09:20');
    w.tueP3 = await period('P3', '09:20', '10:00');
    w.lastYearP1 = await period('P1', '08:00', '08:40', w.lastSession);

    // Another school's class subject, as a target a lesson here must not reach.
    const otherSession = await seedSession(owner, OTHER_SCHOOL, {
      name: '2026/2027',
      startsOn: '2026-09-01',
      endsOn: '2027-07-31',
      current: true,
    });
    const otherClass = await seedClass(owner, OTHER_SCHOOL, otherSession, 'JSS 2', 'A');
    const otherTeacher = await seedRoleRow(owner, OTHER_SCHOOL, Role.Teacher, null);
    const otherSubject = await seedSubject(owner, OTHER_SCHOOL, 'Mathematics');
    w.otherSchoolClassSubject = await seedClassSubject(owner, OTHER_SCHOOL, {
      classId: otherClass,
      subjectId: otherSubject,
      teacherId: otherTeacher,
    });
  }, 120_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  // -------------------------------------------------------------------------
  // Lessons in one period
  // -------------------------------------------------------------------------

  describe('a class in one period', () => {
    it('refuses two core lessons', async () => {
      const outcome = await attempt(async (manager) => {
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aMaths });
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aEnglish });
      });

      expect(outcome).toEqual(refusedBy('23505', 'timetable_lessons_class_core_unique'));
    });

    it('refuses an elective beside a core lesson', async () => {
      const outcome = await attempt(async (manager) => {
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aMaths });
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aFrench });
      });

      expect(outcome).toEqual(refusedBy('23P01', 'timetable_lessons_core_excludes_elective'));
    });

    it('refuses a core lesson beside an elective, whichever came first', async () => {
      const outcome = await attempt(async (manager) => {
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aFrench });
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aMaths });
      });

      expect(outcome).toEqual(refusedBy('23P01', 'timetable_lessons_core_excludes_elective'));
    });

    it('ACCEPTS two electives in parallel, which is how an options block works', async () => {
      const outcome = await attempt(async (manager) => {
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aFrench });
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aArabic });
      });

      expect(outcome).toBe('accepted');
    });

    it('ACCEPTS a core lesson in a slot whose previous lesson was removed', async () => {
      const outcome = await attempt(async (manager) => {
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aMaths });
        await manager.query(
          `UPDATE timetable_lessons SET deleted_at = now() WHERE class_subject_id = $1`,
          [w.aMaths],
        );
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aEnglish });
      });

      expect(outcome).toBe('accepted');
    });
  });

  describe('a teacher in one period', () => {
    it('refuses teaching two classes at once', async () => {
      const outcome = await attempt(async (manager) => {
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aMaths });
        await insertLesson(manager, { period: w.tueP1, classSubject: w.bMaths });
      });

      expect(outcome).toEqual(refusedBy('23505', 'timetable_lessons_teacher_period_unique'));
    });

    it('ACCEPTS the same teacher in the next period', async () => {
      const outcome = await attempt(async (manager) => {
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aMaths });
        await insertLesson(manager, { period: w.tueP2, classSubject: w.bMaths });
      });

      expect(outcome).toBe('accepted');
    });
  });

  // -------------------------------------------------------------------------
  // The copies on a lesson
  // -------------------------------------------------------------------------

  describe("a lesson's copies of its sources", () => {
    it('refuses a teacher other than the class subject’s', async () => {
      const outcome = await attempt((manager) =>
        insertLesson(manager, { period: w.tueP1, classSubject: w.aMaths, teacher: w.obi }),
      );

      expect(outcome).toEqual(refusedBy('23503', 'timetable_lessons_class_subject_fk'));
    });

    it('refuses a core subject claiming to be an elective, which would dodge the core rule', async () => {
      const outcome = await attempt((manager) =>
        insertLesson(manager, { period: w.tueP1, classSubject: w.aMaths, elective: true }),
      );

      expect(outcome).toEqual(refusedBy('23503', 'timetable_lessons_class_subject_fk'));
    });

    it('refuses a class other than the class subject’s', async () => {
      const outcome = await attempt((manager) =>
        insertLesson(manager, { period: w.tueP1, classSubject: w.aMaths, classId: w.jss2b }),
      );

      expect(outcome).toEqual(refusedBy('23503', 'timetable_lessons_class_subject_fk'));
    });

    it('refuses changing the teacher on a lesson directly, rather than on its subject', async () => {
      const outcome = await attempt(async (manager) => {
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aMaths });
        await manager.query(
          `UPDATE timetable_lessons SET teacher_id = $1 WHERE class_subject_id = $2`,
          [w.obi, w.aMaths],
        );
      });

      expect(outcome).toEqual(refusedBy('23503', 'timetable_lessons_class_subject_fk'));
    });
  });

  describe('sessions', () => {
    it("refuses a period from last year for this year's class, claiming the class's session", async () => {
      const outcome = await attempt((manager) =>
        insertLiteralLesson(manager, {
          session: w.session,
          period: w.lastYearP1,
          classId: w.jss2a,
          classSubject: w.aMaths,
          teacher: w.adaeze,
          elective: false,
        }),
      );

      expect(outcome).toEqual(refusedBy('23503', 'timetable_lessons_period_fk'));
    });

    it("refuses the same lesson claiming the period's session instead", async () => {
      const outcome = await attempt((manager) =>
        insertLiteralLesson(manager, {
          session: w.lastSession,
          period: w.lastYearP1,
          classId: w.jss2a,
          classSubject: w.aMaths,
          teacher: w.adaeze,
          elective: false,
        }),
      );

      expect(outcome).toEqual(refusedBy('23503', 'timetable_lessons_class_fk'));
    });
  });

  describe('schools', () => {
    it("refuses another school's class subject, which this school cannot even see", async () => {
      const [other] = await owner.query<Array<{ class_id: string; teacher_id: string }>>(
        `SELECT class_id, teacher_id FROM class_subjects WHERE id = $1`,
        [w.otherSchoolClassSubject],
      );

      const outcome = await attempt((manager) =>
        insertLiteralLesson(manager, {
          session: w.session,
          period: w.tueP1,
          classId: other.class_id,
          classSubject: w.otherSchoolClassSubject,
          teacher: other.teacher_id,
          elective: false,
        }),
      );

      expect(outcome).toMatchObject({ state: '23503' });
    });
  });

  // -------------------------------------------------------------------------
  // Periods
  // -------------------------------------------------------------------------

  describe('periods', () => {
    it('refuses one overlapping another on the same weekday', async () => {
      const outcome = await attempt((manager) =>
        insertPeriod(manager, { weekday: 2, label: 'Break', startsAt: '09:00', endsAt: '09:30' }),
      );

      expect(outcome).toEqual(refusedBy('23P01', 'timetable_periods_no_overlap'));
    });

    it('refuses one wholly inside another', async () => {
      const outcome = await attempt((manager) =>
        insertPeriod(manager, { weekday: 2, label: 'Quiz', startsAt: '08:10', endsAt: '08:20' }),
      );

      expect(outcome).toEqual(refusedBy('23P01', 'timetable_periods_no_overlap'));
    });

    it('ACCEPTS one starting the minute the last ends', async () => {
      const outcome = await attempt((manager) =>
        insertPeriod(manager, { weekday: 2, label: 'P4', startsAt: '10:00', endsAt: '10:40' }),
      );

      expect(outcome).toBe('accepted');
    });

    it('ACCEPTS the same times on another weekday', async () => {
      const outcome = await attempt((manager) =>
        insertPeriod(manager, { weekday: 3, label: 'P1', startsAt: '08:00', endsAt: '08:40' }),
      );

      expect(outcome).toBe('accepted');
    });

    it('refuses a label already used that day, in any case', async () => {
      const outcome = await attempt((manager) =>
        insertPeriod(manager, { weekday: 2, label: 'p1', startsAt: '14:00', endsAt: '14:40' }),
      );

      expect(outcome).toEqual(refusedBy('23505', 'timetable_periods_label_unique_live'));
    });

    it('refuses one ending before it starts', async () => {
      const outcome = await attempt((manager) =>
        insertPeriod(manager, { weekday: 4, label: 'P1', startsAt: '09:00', endsAt: '08:00' }),
      );

      expect(outcome).toEqual(refusedBy('23514', 'timetable_periods_times_ordered'));
    });

    it('refuses a weekday that is not ISO 1 to 7', async () => {
      const outcome = await attempt((manager) =>
        insertPeriod(manager, { weekday: 8, label: 'P1', startsAt: '08:00', endsAt: '08:40' }),
      );

      expect(outcome).toEqual(refusedBy('23514', 'timetable_periods_weekday_iso'));
    });
  });

  // -------------------------------------------------------------------------
  // A class subject changing hands, or going away
  // -------------------------------------------------------------------------

  describe('a class subject changing teacher', () => {
    /** Teachers of the subject's live lessons, read back inside the same attempt. */
    async function lessonTeachers(manager: EntityManager, classSubject: string) {
      const rows = await manager.query<Array<{ teacher_id: string }>>(
        `SELECT DISTINCT teacher_id FROM timetable_lessons
          WHERE class_subject_id = $1 AND deleted_at IS NULL`,
        [classSubject],
      );

      return rows.map((row) => row.teacher_id);
    }

    it('moves every lesson of the subject to the new teacher in the same statement', async () => {
      let after: string[] = [];

      const outcome = await attempt(async (manager) => {
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aMaths });
        await insertLesson(manager, { period: w.tueP3, classSubject: w.aMaths });
        await manager.query(`UPDATE class_subjects SET teacher_id = $1 WHERE id = $2`, [
          w.obi,
          w.aMaths,
        ]);
        after = await lessonTeachers(manager, w.aMaths);
      });

      expect(outcome).toBe('accepted');
      expect(after).toEqual([w.obi]);
    });

    it('refuses the whole change when the new teacher is busy in one of its periods', async () => {
      let before: string[] = [];

      const outcome = await attempt(async (manager) => {
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aMaths });
        await insertLesson(manager, { period: w.tueP3, classSubject: w.aMaths });
        // Obi already teaches JSS 2 B in Tuesday P3.
        await insertLesson(manager, { period: w.tueP3, classSubject: w.bEnglish });
        before = await lessonTeachers(manager, w.aMaths);
        await manager.query(`UPDATE class_subjects SET teacher_id = $1 WHERE id = $2`, [
          w.obi,
          w.aMaths,
        ]);
      });

      expect(before).toEqual([w.adaeze]);
      expect(outcome).toEqual(refusedBy('23505', 'timetable_lessons_teacher_period_unique'));
    });

    it('leaves the subject and all its lessons as they were after that refusal', async () => {
      // Seeded for real this time, so the state after the refused statement can be
      // read from outside its transaction.
      const first = await seedLesson(owner, SCHOOL, {
        periodId: w.tueP1,
        classSubjectId: w.aMaths,
      });
      const second = await seedLesson(owner, SCHOOL, {
        periodId: w.tueP3,
        classSubjectId: w.aMaths,
      });
      const busy = await seedLesson(owner, SCHOOL, {
        periodId: w.tueP3,
        classSubjectId: w.bEnglish,
      });

      try {
        const state = await app
          .transaction(async (manager) => {
            await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [SCHOOL]);
            await manager.query(`UPDATE class_subjects SET teacher_id = $1 WHERE id = $2`, [
              w.obi,
              w.aMaths,
            ]);
          })
          .then(
            () => 'accepted',
            (error: { driverError?: { code?: string } }) => error.driverError?.code,
          );

        expect(state).toBe('23505');

        const [subject] = await owner.query<Array<{ teacher_id: string }>>(
          `SELECT teacher_id FROM class_subjects WHERE id = $1`,
          [w.aMaths],
        );
        const lessons = await owner.query<Array<{ teacher_id: string }>>(
          `SELECT teacher_id FROM timetable_lessons WHERE id = ANY($1)`,
          [[first, second]],
        );

        expect(subject.teacher_id).toBe(w.adaeze);
        expect(lessons.map((lesson) => lesson.teacher_id)).toEqual([w.adaeze, w.adaeze]);
      } finally {
        await owner.query(`DELETE FROM timetable_lessons WHERE id = ANY($1)`, [
          [first, second, busy],
        ]);
      }
    });
  });

  describe('a class subject being removed', () => {
    it('removes its lessons with it, at the same moment and by the same person', async () => {
      let lessons: Array<{ deleted_at: Date | null; deleted_by: string | null }> = [];
      let subject: { deleted_at: Date } | undefined;

      const outcome = await attempt(async (manager) => {
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aMaths });
        await insertLesson(manager, { period: w.tueP2, classSubject: w.aMaths });
        await manager.query(
          `UPDATE class_subjects SET deleted_at = now(), deleted_by = $1 WHERE id = $2`,
          [ADMIN_USER, w.aMaths],
        );
        [subject] = await manager.query<Array<{ deleted_at: Date }>>(
          `SELECT deleted_at FROM class_subjects WHERE id = $1`,
          [w.aMaths],
        );
        lessons = await manager.query(
          `SELECT deleted_at, deleted_by FROM timetable_lessons WHERE class_subject_id = $1`,
          [w.aMaths],
        );
      });

      expect(outcome).toBe('accepted');
      expect(lessons).toHaveLength(2);
      for (const lesson of lessons) {
        expect(lesson.deleted_at).toEqual(subject?.deleted_at);
        expect(lesson.deleted_by).toBe(ADMIN_USER);
      }
    });

    it('frees the slots they held for the next lesson', async () => {
      const outcome = await attempt(async (manager) => {
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aMaths });
        await manager.query(`UPDATE class_subjects SET deleted_at = now() WHERE id = $1`, [
          w.aMaths,
        ]);
        // The class's core slot and Adaeze's slot are both free again.
        await insertLesson(manager, { period: w.tueP1, classSubject: w.aEnglish });
        await insertLesson(manager, { period: w.tueP1, classSubject: w.bMaths });
      });

      expect(outcome).toBe('accepted');
    });
  });
});
