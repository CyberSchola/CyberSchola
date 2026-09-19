import { DataSource } from 'typeorm';

import { seedDemo } from '../src/database/seeds/demo-seed';
import { DEMO_STUDENTS } from '../src/database/seeds/demo-dataset';
import { DEMO_OTHER_SCHOOL_ID, DEMO_SCHOOL_ID, DEMO_USERS } from '../src/database/seeds/demo-users';
import { APP_ROLE_PASSWORD } from './app-database.env';
import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';

/**
 * The staging demo seed, against a real database.
 *
 * Staging runs it on every deploy and every night, so it must rebuild the two
 * schools from nothing, however many times it runs, and it must produce data the
 * application role can read through row-level security, one school at a time.
 */
describe('the demo seed', () => {
  let owner: DataSource;
  let app: DataSource;

  beforeAll(async () => {
    owner = createTestDataSource();
    await owner.initialize();
    await resetSchema(owner);
    await owner.runMigrations({ transaction: 'all' });
    await owner.query(`ALTER ROLE cyberschola_app WITH PASSWORD '${APP_ROLE_PASSWORD}'`);

    const url = new URL(integrationDatabaseUrl());
    url.username = 'cyberschola_app';
    url.password = APP_ROLE_PASSWORD;
    app = new DataSource({ type: 'postgres', url: url.toString(), ssl: false });
    await app.initialize();
  }, 120_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  /** Row counts per table for the demo schools, as the owner sees them. */
  async function counts(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};

    for (const table of ['memberships', 'students', 'teachers', 'class_enrolments', 'attendance']) {
      const [row] = await owner.query<Array<{ count: string }>>(
        `SELECT count(*) AS count FROM ${table} WHERE tenant_id = ANY($1::uuid[])`,
        [[DEMO_SCHOOL_ID, DEMO_OTHER_SCHOOL_ID]],
      );
      result[table] = Number(row.count);
    }

    return result;
  }

  it('builds both schools, and rebuilds them identically when run again', async () => {
    await seedDemo(owner);
    const first = await counts();

    await seedDemo(owner);
    const second = await counts();

    expect(first.memberships).toBe(DEMO_USERS.length);
    expect(first.attendance).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it('puts back anything a visitor changed or removed', async () => {
    await owner.query(`DELETE FROM attendance WHERE tenant_id = $1`, [DEMO_SCHOOL_ID]);
    await owner.query(`UPDATE students SET first_name = 'Changed' WHERE tenant_id = $1`, [
      DEMO_SCHOOL_ID,
    ]);

    await seedDemo(owner);

    const [changed] = await owner.query<Array<{ count: string }>>(
      `SELECT count(*) AS count FROM students WHERE first_name = 'Changed'`,
    );
    expect(Number(changed.count)).toBe(0);
    expect((await counts()).attendance).toBeGreaterThan(0);
  });

  it('gives every demo person a live, active membership with a role', async () => {
    const rows = await owner.query<Array<{ user_id: string; roles: string[] }>>(
      `SELECT m.user_id, array_agg(r.role::text) AS roles
         FROM memberships m JOIN membership_roles r ON r.membership_id = m.id
        WHERE m.deleted_at IS NULL AND m.status = 'ACTIVE'
        GROUP BY m.user_id`,
    );
    const byUser = new Map(rows.map((row) => [row.user_id, row.roles]));
    const roleOf = (key: string) => byUser.get(DEMO_USERS.find((user) => user.key === key)!.userId);

    expect(roleOf('admin')).toEqual(['SCHOOL_ADMIN']);
    expect(roleOf('mathsTeacher')).toEqual(['TEACHER']);
    expect(roleOf('physicsTeacher')).toEqual(['TEACHER']);
    expect(roleOf('student')).toEqual(['STUDENT']);
    expect(roleOf('otherSchoolAdmin')).toEqual(['SCHOOL_ADMIN']);
  });

  it("enrols the plan's twelve pupils in SS2 A, and five subjects with their teachers", async () => {
    const [row] = await owner.query<Array<{ pupils: string; subjects: string; label: string }>>(
      `SELECT (SELECT count(*) FROM class_enrolments e WHERE e.class_id = c.id) AS pupils,
              (SELECT count(*) FROM class_subjects s WHERE s.class_id = c.id) AS subjects,
              g.name || ' ' || c.arm AS label
         FROM classes c JOIN grade_levels g ON g.id = c.grade_level_id
        WHERE c.tenant_id = $1`,
      [DEMO_SCHOOL_ID],
    );

    expect(row).toEqual({ pupils: '12', subjects: '5', label: 'SS2 A' });
  });

  it("gives each pupil a Second Term register matching the plan's attendance figure exactly", async () => {
    const rows = await owner.query<Array<{ name: string; days: string; present: string }>>(
      `SELECT s.first_name || ' ' || s.last_name AS name,
              count(a.id) AS days,
              count(a.id) FILTER (WHERE a.status = 'PRESENT') AS present
         FROM students s
         LEFT JOIN attendance a ON a.student_id = s.id
        WHERE s.tenant_id = $1
        GROUP BY s.id`,
      [DEMO_SCHOOL_ID],
    );
    const byName = new Map(rows.map((row) => [row.name, row]));

    for (const student of DEMO_STUDENTS) {
      const row = byName.get(`${student.firstName} ${student.lastName}`)!;

      if (student.attendancePercent === null) {
        // Esther Williams: enrolled, with no register, as the plan has no figure.
        expect(row.days).toBe('0');
      } else {
        expect(row).toMatchObject({ days: '100', present: String(student.attendancePercent) });
      }
    }
  });

  it("keeps each school's data inside that school for the application role", async () => {
    const visible = (tenant: string) =>
      app.transaction(async (manager) => {
        await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant]);
        const rows = await manager.query<Array<{ tenant_id: string }>>(
          `SELECT DISTINCT tenant_id FROM students`,
        );

        return rows.map((row) => row.tenant_id);
      });

    await expect(visible(DEMO_SCHOOL_ID)).resolves.toEqual([DEMO_SCHOOL_ID]);
    await expect(visible(DEMO_OTHER_SCHOOL_ID)).resolves.toEqual([DEMO_OTHER_SCHOOL_ID]);
  });
});
