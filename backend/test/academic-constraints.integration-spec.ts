import { DataSource, type QueryRunner } from 'typeorm';

import { Role } from '../src/auth/permission.matrix';
import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';
import { seedMember } from './people.fixtures';

/**
 * The invariants the academic spine hands to the database.
 *
 * Each of these was put in Postgres rather than in application code because the
 * application version fails under concurrency: two administrators acting at the
 * same moment can each read a clean state and both commit. So each invariant is
 * attempted directly, and the two that exist specifically to survive races are
 * raced.
 *
 * Runs as `cyberschola_app` with a tenant context, as a request would.
 */
describe('academic spine constraints', () => {
  let owner: DataSource;
  let app: DataSource;

  const APP_PASSWORD = 'app_role_local_only';
  const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const OTHER_SCHOOL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  let session: string;
  let grade: string;
  let classA: string;
  let otherSchoolClass: string;
  let otherSchoolSession: string;
  let student: string;

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
      logging: false,
    });
    await app.initialize();

    await owner.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Greenfield', 'greenfield'), ($2, 'Brookvale', 'brookvale')`,
      [SCHOOL, OTHER_SCHOOL],
    );

    session = await ownerInsert(
      `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
       VALUES ($1, '2026/2027', '2026-09-01', '2027-07-31', true) RETURNING id`,
      [SCHOOL],
    );
    grade = await ownerInsert(
      `INSERT INTO grade_levels (tenant_id, name, position) VALUES ($1, 'JSS 2', 8) RETURNING id`,
      [SCHOOL],
    );
    classA = await ownerInsert(
      `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm) VALUES ($1, $2, $3, 'A') RETURNING id`,
      [SCHOOL, session, grade],
    );

    otherSchoolSession = await ownerInsert(
      `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
       VALUES ($1, '2026/2027', '2026-09-01', '2027-07-31', true) RETURNING id`,
      [OTHER_SCHOOL],
    );
    const otherGrade = await ownerInsert(
      `INSERT INTO grade_levels (tenant_id, name, position) VALUES ($1, 'JSS 2', 8) RETURNING id`,
      [OTHER_SCHOOL],
    );
    otherSchoolClass = await ownerInsert(
      `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm) VALUES ($1, $2, $3, 'A') RETURNING id`,
      [OTHER_SCHOOL, otherSchoolSession, otherGrade],
    );

    const { roleRows } = await seedMember(owner, SCHOOL, '11111111-1111-4111-8111-111111111111', [
      Role.Student,
    ]);
    student = roleRows[Role.Student]!;
  }, 120_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  async function ownerInsert(sql: string, params: unknown[]): Promise<string> {
    const [row] = await owner.query<Array<{ id: string }>>(sql, params);
    return row.id;
  }

  /** Runs statements as the app role in one transaction, in the school's context. */
  async function asSchool(sql: string, params: unknown[] = [], tenant = SCHOOL): Promise<unknown> {
    return app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant]);
      return manager.query<unknown>(sql, params);
    });
  }

  /** The SQLSTATE a rejected statement failed with. */
  async function sqlStateOf(work: Promise<unknown>): Promise<string | undefined> {
    try {
      await work;
      return undefined;
    } catch (error) {
      const driverError = (error as { driverError?: { code?: string } }).driverError;
      return driverError?.code ?? (error as { code?: string }).code;
    }
  }

  describe('sessions', () => {
    it('allows only one current session per school', async () => {
      const state = await sqlStateOf(
        asSchool(
          `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
           VALUES ($1, '2027/2028', '2027-09-01', '2028-07-31', true)`,
          [SCHOOL],
        ),
      );

      expect(state).toBe('23505');
    });

    it('lets another school have its own current session', async () => {
      // The index is per school. A second current session elsewhere is not a
      // conflict, and the other school already has one.
      const [row] = await owner.query<Array<{ count: string }>>(
        `SELECT count(*)::text AS count FROM academic_sessions WHERE is_current`,
      );

      expect(Number(row?.count)).toBe(2);
    });

    it('refuses overlapping sessions in one school', async () => {
      const state = await sqlStateOf(
        asSchool(
          `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on)
           VALUES ($1, 'Overlap', '2027-01-01', '2027-12-31')`,
          [SCHOOL],
        ),
      );

      expect(state).toBe('23P01');
    });

    it('refuses a session that ends before it starts', async () => {
      const state = await sqlStateOf(
        asSchool(
          `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on)
           VALUES ($1, 'Backwards', '2030-07-31', '2030-01-01')`,
          [SCHOOL],
        ),
      );

      expect(state).toBe('23514');
    });
  });

  describe('terms', () => {
    beforeAll(async () => {
      await owner.query(
        `INSERT INTO terms (tenant_id, session_id, name, starts_on, ends_on)
         VALUES ($1, $2, 'First Term', '2026-09-01', '2026-12-15')`,
        [SCHOOL, session],
      );
    });

    it('refuses a term that overlaps another in the same session', async () => {
      const state = await sqlStateOf(
        asSchool(
          `INSERT INTO terms (tenant_id, session_id, name, starts_on, ends_on)
           VALUES ($1, $2, 'Overlapping', '2026-12-01', '2027-03-31')`,
          [SCHOOL, session],
        ),
      );

      expect(state).toBe('23P01');
    });

    it('accepts a term that starts the day after the previous one ends', async () => {
      // Guards against an off-by-one in the range bounds: inclusive ranges that
      // touch on a shared day would wrongly count as overlapping.
      const state = await sqlStateOf(
        asSchool(
          `INSERT INTO terms (tenant_id, session_id, name, starts_on, ends_on)
           VALUES ($1, $2, 'Second Term', '2026-12-16', '2027-03-31')`,
          [SCHOOL, session],
        ),
      );

      expect(state).toBeUndefined();
    });

    it('refuses a term outside its session', async () => {
      const state = await sqlStateOf(
        asSchool(
          `INSERT INTO terms (tenant_id, session_id, name, starts_on, ends_on)
           VALUES ($1, $2, 'Stray', '2027-06-01', '2027-09-30')`,
          [SCHOOL, session],
        ),
      );

      expect(state).toBe('23514');
    });

    it('refuses narrowing a session so a term would fall outside it', async () => {
      // The other direction of the same rule. Without the session-side trigger,
      // shortening the year would strand a term outside the session it belongs to.
      const state = await sqlStateOf(
        asSchool(`UPDATE academic_sessions SET ends_on = '2026-11-30' WHERE id = $1`, [session]),
      );

      expect(state).toBe('23514');
    });
  });

  describe('classes and enrolment', () => {
    it('refuses a duplicate class for the same session, grade and arm', async () => {
      const state = await sqlStateOf(
        asSchool(
          `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm) VALUES ($1, $2, $3, 'A')`,
          [SCHOOL, session, grade],
        ),
      );

      expect(state).toBe('23505');
    });

    it('treats the arm case-insensitively, so "a" and "A" are the same class', async () => {
      const state = await sqlStateOf(
        asSchool(
          `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm) VALUES ($1, $2, $3, 'a')`,
          [SCHOOL, session, grade],
        ),
      );

      expect(state).toBe('23505');
    });

    it('refuses enrolling one student in two classes in the same session', async () => {
      const classB = await ownerInsert(
        `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm) VALUES ($1, $2, $3, 'B') RETURNING id`,
        [SCHOOL, session, grade],
      );

      await asSchool(
        `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id) VALUES ($1, $2, $3, $4)`,
        [SCHOOL, classA, session, student],
      );

      const state = await sqlStateOf(
        asSchool(
          `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id) VALUES ($1, $2, $3, $4)`,
          [SCHOOL, classB, session, student],
        ),
      );

      expect(state).toBe('23505');
    });

    it('refuses an enrolment whose session disagrees with its class', async () => {
      // The copy of the session on an enrolment exists to make the rule above
      // enforceable, and the composite key is what stops that copy being wrong.
      const otherSession = await ownerInsert(
        `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on)
         VALUES ($1, '2028/2029', '2028-09-01', '2029-07-31') RETURNING id`,
        [SCHOOL],
      );

      const state = await sqlStateOf(
        asSchool(
          `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id) VALUES ($1, $2, $3, $4)`,
          [SCHOOL, classA, otherSession, student],
        ),
      );

      expect(state).toBe('23503');
    });
  });

  describe('references across schools', () => {
    it("refuses enrolling a student into another school's class", async () => {
      // The hole a plain foreign key leaves. A foreign key check bypasses
      // row-level security, so with `class_id REFERENCES classes(id)` this insert
      // would succeed even though this school cannot see the class. The
      // composite (tenant_id, class_id) key makes it a violation.
      const state = await sqlStateOf(
        asSchool(
          `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id) VALUES ($1, $2, $3, $4)`,
          [SCHOOL, otherSchoolClass, otherSchoolSession, student],
        ),
      );

      expect(state).toBe('23503');
    });
  });

  describe('under concurrent writes', () => {
    /**
     * Two transactions on separate connections, each in the school's context.
     *
     * The outcome asserted is timing-independent. Whether the second insert
     * blocks on the first transaction's lock and then fails, or runs after the
     * first commits and fails immediately, exactly one of the two may commit.
     */
    async function race(first: string, second: string, params: unknown[]): Promise<number> {
      const runners: QueryRunner[] = [app.createQueryRunner(), app.createQueryRunner()];

      try {
        for (const runner of runners) {
          await runner.connect();
          await runner.startTransaction();
          await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [SCHOOL]);
        }

        const [a, b] = runners as [QueryRunner, QueryRunner];
        let committed = 0;

        await a.query(first, params);
        const blocked = b.query(second, params).then(
          () => true,
          () => false,
        );

        await a.commitTransaction();
        committed += 1;

        if (await blocked) {
          await b.commitTransaction();
          committed += 1;
        } else {
          await b.rollbackTransaction();
        }

        return committed;
      } finally {
        for (const runner of runners) {
          if (runner.isTransactionActive) await runner.rollbackTransaction();
          await runner.release();
        }
      }
    }

    it('lets exactly one of two overlapping terms commit', async () => {
      const racedSession = await ownerInsert(
        `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on)
         VALUES ($1, '2031/2032', '2031-09-01', '2032-07-31') RETURNING id`,
        [SCHOOL],
      );

      const committed = await race(
        `INSERT INTO terms (tenant_id, session_id, name, starts_on, ends_on)
         VALUES ($1, $2, 'Raced One', '2031-09-01', '2031-12-15')`,
        `INSERT INTO terms (tenant_id, session_id, name, starts_on, ends_on)
         VALUES ($1, $2, 'Raced Two', '2031-10-01', '2032-01-31')`,
        [SCHOOL, racedSession],
      );

      expect(committed).toBe(1);
    });

    it('lets exactly one of two sessions become current', async () => {
      // Clear the existing current session first, so the race is between the two
      // new rows rather than against a flag already held.
      await owner.query(`UPDATE academic_sessions SET is_current = false WHERE tenant_id = $1`, [
        SCHOOL,
      ]);

      const committed = await race(
        `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
         VALUES ($1, 'Race A', '2040-09-01', '2041-07-31', true)`,
        `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
         VALUES ($1, 'Race B', '2042-09-01', '2043-07-31', true)`,
        [SCHOOL],
      );

      expect(committed).toBe(1);

      const [row] = await owner.query<Array<{ count: string }>>(
        `SELECT count(*)::text AS count FROM academic_sessions WHERE tenant_id = $1 AND is_current`,
        [SCHOOL],
      );
      expect(Number(row?.count)).toBe(1);
    });
  });
});
