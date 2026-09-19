// Must come first: it sets the database connection before the app loads.
import { type E2eHarness, request, startE2e } from './e2e.harness';

import { DiscoveryModule } from '@nestjs/core';

import { DEMO_RESULTS } from '../src/database/seeds/demo-dataset';
import { seedDemo } from '../src/database/seeds/demo-seed';
import { DEMO_OTHER_SCHOOL_ID, DEMO_SCHOOL_ID, DEMO_USERS } from '../src/database/seeds/demo-users';

/**
 * Results over HTTP, on the hackathon dataset itself.
 *
 * The seed is the one staging runs, so these tests prove the numbers the demo
 * shows: every total matches the team's plan, and each caller sees only what
 * the student scope allows. The database rules on the table are attempted as
 * raw SQL by the application role at the end.
 */
describe('results', () => {
  let e2e: E2eHarness;

  const user = (key: string) => DEMO_USERS.find((candidate) => candidate.key === key)!.userId;

  interface Performance {
    session: { name: string };
    term: { name: string };
    subjects: Array<{ subject: string; average: number; below50: number; students: number }>;
    students: Array<{
      studentId: string;
      name: string;
      attendanceRate: number | null;
      average: number | null;
      subjects: Array<{ subject: string; ca1: number; ca2: number; exam: number; total: number }>;
    }>;
  }

  beforeAll(async () => {
    e2e = await startE2e(
      async (owner) => {
        await seedDemo(owner);
      },
      [DiscoveryModule],
    );
  }, 180_000);

  afterAll(async () => {
    await e2e?.close();
  });

  async function performance(as: string, query = '', expected = 200) {
    const response = await request(e2e.server())
      .get(`/api/v1/results/performance${query}`)
      .set({ authorization: await e2e.bearer(user(as)) })
      .expect(expected);

    return (response.body as { data: Performance }).data;
  }

  const one = async (sql: string, params: unknown[]) =>
    (await e2e.owner.query<Array<{ id: string }>>(sql, params))[0]?.id;

  describe('what an administrator sees', () => {
    it('reports the Second Term for SS2 A, the term that has results', async () => {
      const result = await performance('admin');

      expect(result.session.name).toBe('2025/2026');
      expect(result.term.name).toBe('Second Term');
    });

    it("gives every pupil the plan's totals, subject by subject", async () => {
      const result = await performance('admin');

      for (const [name, scores] of Object.entries(DEMO_RESULTS)) {
        const pupil = result.students.find((student) => student.name === name)!;
        const totals = Object.fromEntries(pupil.subjects.map((s) => [s.subject, s.total]));

        expect(totals).toEqual({
          Mathematics: scores[0].reduce((a, b) => a + b, 0),
          'English Language': scores[1].reduce((a, b) => a + b, 0),
          Physics: scores[2].reduce((a, b) => a + b, 0),
          Chemistry: scores[3].reduce((a, b) => a + b, 0),
          Biology: scores[4].reduce((a, b) => a + b, 0),
        });
      }
    });

    it('summarises each subject, Mathematics weakest and English strongest', async () => {
      const { subjects } = await performance('admin');
      const bySubject = Object.fromEntries(subjects.map((s) => [s.subject, s]));

      expect(bySubject.Mathematics).toMatchObject({ average: 55.5, below50: 4, students: 11 });
      expect(bySubject['English Language']).toMatchObject({ average: 79.3, below50: 0 });
      expect(bySubject.Physics).toMatchObject({ average: 63, below50: 2 });
    });

    it('lists Esther Williams with no results rather than leaving her out', async () => {
      const esther = (await performance('admin')).students.find(
        (s) => s.name === 'Esther Williams',
      );

      expect(esther).toMatchObject({ average: null, attendanceRate: null, subjects: [] });
    });

    it("includes each pupil's attendance for the term", async () => {
      const daniel = (await performance('admin')).students.find((s) => s.name === 'Daniel Okafor');

      expect(daniel?.attendanceRate).toBe(95);
    });
  });

  describe('who sees what', () => {
    it('gives a subject teacher the pupils they teach, without attendance', async () => {
      const result = await performance('mathsTeacher');

      expect(result.students).toHaveLength(12);
      expect(result.students.every((student) => student.attendanceRate === null)).toBe(true);
    });

    it('gives a pupil only themselves', async () => {
      const result = await performance('student');

      expect(result.students.map((student) => student.name)).toEqual(['Daniel Okafor']);
      expect(result.subjects.every((subject) => subject.students === 1)).toBe(true);
    });

    it("gives another school's administrator nothing of this school, not even its terms", async () => {
      // Brookvale's session has no terms of its own. Were CyberSchola Demo
      // College's visible, this would report its Second Term instead of refusing.
      const response = await request(e2e.server())
        .get('/api/v1/results/performance')
        .set({ authorization: await e2e.bearer(user('otherSchoolAdmin')) })
        .expect(422);

      expect((response.body as { details: string[] }).details).toEqual([
        'The session has no terms yet.',
      ]);
    });
  });

  describe('filters', () => {
    it('narrows to one subject', async () => {
      const subjectId = await one(
        `SELECT id FROM subjects WHERE tenant_id = $1 AND name = 'Physics'`,
        [DEMO_SCHOOL_ID],
      );
      const result = await performance('admin', `?subjectId=${subjectId}`);

      expect(result.subjects.map((s) => s.subject)).toEqual(['Physics']);
    });

    it("answers 404 for another school's class or session", async () => {
      const classId = await one(`SELECT id FROM classes WHERE tenant_id = $1`, [
        DEMO_OTHER_SCHOOL_ID,
      ]);
      const sessionId = await one(`SELECT id FROM academic_sessions WHERE tenant_id = $1`, [
        DEMO_OTHER_SCHOOL_ID,
      ]);

      await performance('admin', `?classId=${classId}`, 404);
      await performance('admin', `?sessionId=${sessionId}`, 404);
    });

    it('refuses a filter that is not a UUID', async () => {
      await performance('admin', '?classId=ss2a', 400);
    });

    it('refuses a caller with no token', async () => {
      await request(e2e.server()).get('/api/v1/results/performance').expect(401);
    });
  });

  describe('the database rules, as the application role', () => {
    /** Runs one statement as cyberschola_app in the demo school, rolled back, and returns its SQLSTATE. */
    async function stateOf(sql: string): Promise<string | undefined> {
      const runner = e2e.owner.createQueryRunner();

      try {
        await runner.connect();
        await runner.startTransaction();
        await runner.query(`SET LOCAL ROLE cyberschola_app`);
        await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [DEMO_SCHOOL_ID]);
        await runner.query(sql);

        return undefined;
      } catch (error) {
        return (error as { driverError?: { code?: string } }).driverError?.code;
      } finally {
        await runner.rollbackTransaction().catch(() => undefined);
        await runner.release();
      }
    }

    /**
     * Inserts a copy of Daniel's Second Term Mathematics CA1 with the given
     * expressions substituted, so each case changes exactly one thing.
     */
    const copyOfDanielsCa1 = (
      overrides: Partial<Record<'term' | 'subject' | 'type' | 'score' | 'max', string>> = {},
    ) => `
      INSERT INTO results (tenant_id, student_id, enrolment_id, class_id, session_id, term_id,
                           class_subject_id, subject_id, assessment_type, score, max_score,
                           assessed_on, recorded_by)
      SELECT r.tenant_id, r.student_id, r.enrolment_id, r.class_id, r.session_id,
             ${overrides.term ?? 'r.term_id'}, r.class_subject_id, ${overrides.subject ?? 'r.subject_id'},
             ${overrides.type ?? 'r.assessment_type'}, ${overrides.score ?? 'r.score'},
             ${overrides.max ?? 'r.max_score'}, r.assessed_on, r.recorded_by
        FROM results r
        JOIN students s ON s.id = r.student_id
        JOIN subjects sub ON sub.id = r.subject_id
       WHERE s.first_name = 'Daniel' AND sub.name = 'Mathematics' AND r.assessment_type = 'CA1'`;

    const FIRST_TERM = `(SELECT id FROM terms WHERE name = 'First Term' AND tenant_id = '${DEMO_SCHOOL_ID}')`;

    it('accepts a correct score in another term, so the cases below fail for their own reason', async () => {
      await expect(stateOf(copyOfDanielsCa1({ term: FIRST_TERM }))).resolves.toBeUndefined();
    });

    it('refuses a second score for the same assessment', async () => {
      await expect(stateOf(copyOfDanielsCa1())).resolves.toBe('23505');
    });

    it('refuses a score above its maximum', async () => {
      await expect(
        stateOf(copyOfDanielsCa1({ term: FIRST_TERM, score: '25', max: '20' })),
      ).resolves.toBe('23514');
    });

    it("refuses a subject that is not the class subject's", async () => {
      const english = `(SELECT id FROM subjects WHERE name = 'English Language' AND tenant_id = '${DEMO_SCHOOL_ID}')`;

      await expect(stateOf(copyOfDanielsCa1({ term: FIRST_TERM, subject: english }))).resolves.toBe(
        '23503',
      );
    });
  });
});
