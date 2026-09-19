// Must come first: it sets the database connection before the app loads.
import { type E2eHarness, request, startE2e } from './e2e.harness';

import { DiscoveryModule } from '@nestjs/core';

import { seedDemo } from '../src/database/seeds/demo-seed';
import { DEMO_OTHER_SCHOOL_ID, DEMO_SCHOOL_ID, DEMO_USERS } from '../src/database/seeds/demo-users';

/**
 * Entering scores over HTTP, on the hackathon dataset.
 *
 * The Mathematics teacher enters and corrects SS2 A's Mathematics scores. Every
 * refusal is checked twice: the answer, and that nothing was written. The tests
 * share one database and run in order, so each one says what it leaves behind.
 */
describe('entering scores', () => {
  let e2e: E2eHarness;
  let maths: string;
  let physics: string;
  let secondTerm: string;
  let otherSchoolTerm: string;
  let pupils: Record<string, string>;

  const user = (key: string) => DEMO_USERS.find((candidate) => candidate.key === key)!.userId;

  interface Sheet {
    subject: string;
    class: string;
    term: { name: string };
    maxScores: { ca1: number; ca2: number; exam: number };
    pupils: Array<{
      studentId: string;
      name: string;
      ca1: number | null;
      ca2: number | null;
      exam: number | null;
      total: number;
    }>;
    inserted?: number;
    updated?: number;
  }

  const one = async (sql: string, params: unknown[]) =>
    (await e2e.owner.query<Array<{ id: string }>>(sql, params))[0]?.id;

  beforeAll(async () => {
    e2e = await startE2e(
      async (owner) => {
        await seedDemo(owner);
      },
      [DiscoveryModule],
    );

    const classSubject = (subject: string) =>
      one(
        `SELECT cs.id FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id
          WHERE cs.tenant_id = $1 AND s.name = $2`,
        [DEMO_SCHOOL_ID, subject],
      );

    maths = (await classSubject('Mathematics'))!;
    physics = (await classSubject('Physics'))!;
    secondTerm = (await one(`SELECT id FROM terms WHERE tenant_id = $1 AND name = 'Second Term'`, [
      DEMO_SCHOOL_ID,
    ]))!;

    // Brookvale has no terms of its own in the seed; give it one to point at.
    otherSchoolTerm = (await one(
      `INSERT INTO terms (tenant_id, session_id, name, starts_on, ends_on)
       SELECT tenant_id, id, 'Brookvale First Term', starts_on, starts_on + 60
         FROM academic_sessions WHERE tenant_id = $1 LIMIT 1
       RETURNING id`,
      [DEMO_OTHER_SCHOOL_ID],
    ))!;

    const rows = await e2e.owner.query<Array<{ id: string; first_name: string }>>(
      `SELECT id, first_name FROM students WHERE tenant_id = $1`,
      [DEMO_SCHOOL_ID],
    );
    pupils = Object.fromEntries(rows.map((row) => [row.first_name, row.id]));
  }, 180_000);

  afterAll(async () => {
    await e2e?.close();
  });

  async function sheet(as: string, classSubjectId = maths, termId = secondTerm, expected = 200) {
    const response = await request(e2e.server())
      .get(`/api/v1/results/sheet?classSubjectId=${classSubjectId}&termId=${termId}`)
      .set({ authorization: await e2e.bearer(user(as)) })
      .expect(expected);

    return response.body as { data: Sheet; details?: string[] };
  }

  async function save(as: string, body: Record<string, unknown>, expected = 200) {
    const response = await request(e2e.server())
      .put('/api/v1/results/sheet')
      .set({ authorization: await e2e.bearer(user(as)) })
      .send({ classSubjectId: maths, termId: secondTerm, ...body })
      .expect(expected);

    return response.body as { data: Sheet; details?: string[]; message?: string };
  }

  const row = (data: Sheet, firstName: string) =>
    data.pupils.find((pupil) => pupil.studentId === pupils[firstName])!;

  /** How many live Mathematics scores are recorded this term, straight from the table. */
  const recorded = async () =>
    Number(
      (
        await e2e.owner.query<Array<{ n: string }>>(
          `SELECT count(*) AS n FROM results
            WHERE class_subject_id = $1 AND term_id = $2 AND deleted_at IS NULL`,
          [maths, secondTerm],
        )
      )[0].n,
    );

  describe('the sheet', () => {
    it("gives the Mathematics teacher every pupil in SS2 A with this term's scores", async () => {
      const { data } = await sheet('mathsTeacher');

      expect(data).toMatchObject({ subject: 'Mathematics', class: 'SS2 A' });
      expect(data.term.name).toBe('Second Term');
      expect(data.maxScores).toEqual({ ca1: 20, ca2: 20, exam: 60 });
      expect(data.pupils).toHaveLength(12);
      expect(row(data, 'Daniel').total).toBe(63);
    });

    it('lists Esther Williams with no scores yet, so she can be given some', async () => {
      const { data } = await sheet('mathsTeacher');

      expect(row(data, 'Esther')).toMatchObject({ ca1: null, ca2: null, exam: null, total: 0 });
    });
  });

  describe('saving', () => {
    it("enters Esther's first score and reports it as new", async () => {
      const before = await recorded();
      const { data } = await save('mathsTeacher', {
        assessmentType: 'CA1',
        entries: [{ studentId: pupils.Esther, score: 15.1 }],
      });

      expect(data).toMatchObject({ assessmentType: 'CA1', inserted: 1, updated: 0 });
      expect(row(data, 'Esther')).toMatchObject({ ca1: 15.1, total: 15.1 });
      expect(await recorded()).toBe(before + 1);
    });

    it("corrects Daniel's CA1 in place and records who changed it", async () => {
      const before = await recorded();
      const { data } = await save('mathsTeacher', {
        assessmentType: 'CA1',
        entries: [{ studentId: pupils.Daniel, score: 18.5, remarks: 'Re-marked question 4.' }],
      });

      expect(data).toMatchObject({ inserted: 0, updated: 1 });
      expect(row(data, 'Daniel').ca1).toBe(18.5);
      expect(await recorded()).toBe(before);

      const [stored] = await e2e.owner.query<Array<{ user_id: string; remarks: string }>>(
        `SELECT m.user_id, r.remarks FROM results r
           JOIN memberships m ON m.id = r.recorded_by
          WHERE r.student_id = $1 AND r.class_subject_id = $2 AND r.term_id = $3
            AND r.assessment_type = 'CA1'`,
        [pupils.Daniel, maths, secondTerm],
      );

      expect(stored).toEqual({ user_id: user('mathsTeacher'), remarks: 'Re-marked question 4.' });
    });

    it('adds up decimal scores without floating point noise', async () => {
      const { data } = await save('mathsTeacher', {
        assessmentType: 'CA2',
        entries: [{ studentId: pupils.Esther, score: 16.2 }],
      });

      // In plain JavaScript 15.1 + 16.2 is 31.299999999999997.
      expect(row(data, 'Esther').total).toBe(31.3);
    });

    it('shows the new scores in the performance read', async () => {
      const response = await request(e2e.server())
        .get('/api/v1/results/performance')
        .set({ authorization: await e2e.bearer(user('admin')) })
        .expect(200);
      const esther = (
        response.body as {
          data: { students: Array<{ name: string; subjects: Array<{ subject: string }> }> };
        }
      ).data.students.find((student) => student.name === 'Esther Williams');

      expect(esther?.subjects).toEqual([
        expect.objectContaining({ subject: 'Mathematics', ca1: 15.1, ca2: 16.2, total: 31.3 }),
      ]);
    });

    it('lets an administrator enter scores too', async () => {
      const { data } = await save('admin', {
        assessmentType: 'EXAM',
        entries: [{ studentId: pupils.Esther, score: 40 }],
      });

      expect(row(data, 'Esther').total).toBe(71.3);
    });
  });

  describe('who may enter', () => {
    it('refuses the Physics teacher on Mathematics, and writes nothing', async () => {
      const before = await recorded();
      const body = await save(
        'physicsTeacher',
        { assessmentType: 'CA1', entries: [{ studentId: pupils.Daniel, score: 1 }] },
        403,
      );

      expect(body.message).toBe(
        'You can only enter scores for a subject you teach in the current session.',
      );
      expect(await recorded()).toBe(before);
    });

    it("refuses the Physics teacher Mathematics' sheet as well", async () => {
      await sheet('physicsTeacher', maths, secondTerm, 403);
    });

    it('gives the Physics teacher their own sheet', async () => {
      const { data } = await sheet('physicsTeacher', physics);

      expect(data.subject).toBe('Physics');
    });

    it('refuses a pupil outright', async () => {
      await sheet('student', maths, secondTerm, 403);
      await save('student', { assessmentType: 'CA1', entries: [] }, 403);
    });

    it("answers 404 to another school's administrator, for the class subject and for its term", async () => {
      await sheet('otherSchoolAdmin', maths, secondTerm, 404);
      await sheet('admin', maths, otherSchoolTerm, 404);
    });

    it('refuses a caller with no token', async () => {
      await request(e2e.server())
        .get(`/api/v1/results/sheet?classSubjectId=${maths}&termId=${secondTerm}`)
        .expect(401);
    });
  });

  describe('what a sheet may hold', () => {
    it('refuses a CA over 20 and saves none of the sheet, not even the valid line', async () => {
      const before = await recorded();
      const body = await save(
        'mathsTeacher',
        {
          assessmentType: 'CA2',
          entries: [
            { studentId: pupils.Daniel, score: 12 },
            { studentId: pupils.Ada, score: 21 },
          ],
        },
        422,
      );

      expect(body.details).toEqual([`CA2 is out of 20. Over it: ${pupils.Ada}.`]);
      expect(await recorded()).toBe(before);
      expect(row((await sheet('mathsTeacher')).data, 'Daniel').ca2).toBe(14);
    });

    it('refuses a pupil who does not take the subject here', async () => {
      const outsider = await one(`SELECT id FROM students WHERE tenant_id = $1 LIMIT 1`, [
        DEMO_OTHER_SCHOOL_ID,
      ]);
      const body = await save(
        'mathsTeacher',
        { assessmentType: 'CA1', entries: [{ studentId: outsider, score: 10 }] },
        422,
      );

      expect(body.details).toEqual([`Not taking Mathematics in SS2 A: ${outsider}.`]);
    });

    it('refuses the same pupil twice in one sheet', async () => {
      const body = await save(
        'mathsTeacher',
        {
          assessmentType: 'CA1',
          entries: [
            { studentId: pupils.Daniel, score: 10 },
            { studentId: pupils.Daniel, score: 11 },
          ],
        },
        422,
      );

      expect(body.details).toEqual(['entries must not name the same pupil twice']);
    });

    it.each([
      ['a negative score', { assessmentType: 'CA1', entries: [{ score: -1 }] }],
      ['three decimals', { assessmentType: 'CA1', entries: [{ score: 1.125 }] }],
      [
        'a pupil that is not a UUID',
        { assessmentType: 'CA1', entries: [{ studentId: 'ada', score: 1 }] },
      ],
      ['an unknown assessment', { assessmentType: 'CA3', entries: [{ score: 1 }] }],
      [
        'an impossible date',
        { assessmentType: 'CA1', assessedOn: '2026-02-30', entries: [{ score: 1 }] },
      ],
      ['no entries', { assessmentType: 'CA1', entries: [] }],
    ])('refuses %s with 400', async (_, body) => {
      const entries = (body.entries as Array<Record<string, unknown>>).map((entry) => ({
        studentId: pupils.Daniel,
        ...entry,
      }));

      await save('mathsTeacher', { ...body, entries }, 400);
    });
  });
});
