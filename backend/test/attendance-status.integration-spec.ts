import { DataSource, type QueryRunner } from 'typeorm';

import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_TYPES,
  AttendanceType,
  STATUSES_BY_TYPE,
} from '../src/attendance/attendance.enums';
import { Role } from '../src/auth/permission.matrix';
import { APP_ROLE_PASSWORD } from './app-database.env';
import { seedAcademicYear, seedClass, SCHOOL_DAY } from './attendance.fixtures';
import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';
import { seedMember, seedRoleRow } from './people.fixtures';

const CONSTRAINT = 'attendance_status_allowed_for_type';

/**
 * Blueprint section 91, the whole matrix, asked of the database directly.
 *
 * `STATUSES_BY_TYPE` is the readable statement of which statuses each kind of
 * person may hold, and the API turns it into a 422. It is not the boundary: a
 * job, a migration or a hand-written statement never passes through the API.
 * The check constraint is. So every one of the eighteen type and status
 * combinations is inserted here as the application role, and the database's
 * answer is compared with the map, in both directions: a cell the map allows
 * must be accepted, and a cell it refuses must be refused by that constraint,
 * not by some other rule that happens to fire first.
 */
describe('attendance statuses, per kind of person, at the database', () => {
  let owner: DataSource;
  let app: DataSource;

  const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ADMIN_USER = '90000000-0000-4000-8000-000000000001';

  /** A valid subject for each kind, so the status is the only thing that can fail. */
  let subject: Record<AttendanceType, Record<string, string | null>>;

  /** The database's answer for every cell, filled once in beforeAll. */
  const answer = new Map<string, 'accepted' | 'refused'>();
  const cell = (type: AttendanceType, status: string) => `${type} + ${status}`;

  /**
   * Tries one row inside a savepoint, and rolls it back either way.
   *
   * Returns whether the database accepted it. A refusal by anything other than
   * the status constraint is rethrown, because then the cell was never really
   * asked.
   */
  async function attempt(
    runner: QueryRunner,
    type: AttendanceType,
    status: string,
  ): Promise<'accepted' | 'refused'> {
    const row = subject[type];

    await runner.query('SAVEPOINT cell');

    try {
      await runner.query(
        `INSERT INTO attendance
           (tenant_id, attendance_type, date, status, marked_by,
            student_id, teacher_id, staff_id, enrolment_id, class_id, session_id, term_id)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          SCHOOL,
          type,
          SCHOOL_DAY,
          status,
          row.markedBy,
          row.studentId,
          row.teacherId,
          row.staffId,
          row.enrolmentId,
          row.classId,
          row.sessionId,
          row.termId,
        ],
      );

      return 'accepted';
    } catch (error) {
      const constraint = (error as { driverError?: { constraint?: string } }).driverError
        ?.constraint;

      if (constraint !== CONSTRAINT) {
        throw error;
      }

      return 'refused';
    } finally {
      await runner.query('ROLLBACK TO SAVEPOINT cell');
    }
  }

  /** Asks every cell for the given statuses, in one transaction that is rolled back. */
  async function askDatabase(statuses: readonly string[]): Promise<void> {
    const runner = app.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    try {
      await runner.query(`SELECT set_config('app.current_user', $1, true)`, [ADMIN_USER]);
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [SCHOOL]);

      for (const type of ATTENDANCE_TYPES) {
        for (const status of statuses) {
          answer.set(cell(type, status), await attempt(runner, type, status));
        }
      }
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  }

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
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Greenfield', 'greenfield')`,
      [SCHOOL],
    );

    const { membershipId } = await seedMember(owner, SCHOOL, ADMIN_USER, [Role.SchoolAdmin]);
    const year = await seedAcademicYear(owner, SCHOOL);
    const klass = await seedClass(owner, SCHOOL, year, { studentCount: 1 });
    const studentId = klass.studentIds[0];
    const none = {
      studentId: null,
      teacherId: null,
      staffId: null,
      enrolmentId: null,
      classId: null,
      sessionId: null,
      termId: null,
    };

    subject = {
      [AttendanceType.Student]: {
        ...none,
        markedBy: membershipId,
        studentId,
        enrolmentId: klass.enrolmentIds[studentId],
        classId: klass.classId,
        sessionId: year.sessionId,
        termId: year.termId,
      },
      [AttendanceType.Teacher]: {
        ...none,
        markedBy: membershipId,
        teacherId: await seedRoleRow(owner, SCHOOL, Role.Teacher, null),
      },
      [AttendanceType.Staff]: {
        ...none,
        markedBy: membershipId,
        staffId: await seedRoleRow(owner, SCHOOL, Role.Staff, null),
      },
    };

    await askDatabase(ATTENDANCE_STATUSES);
  }, 120_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  const cells = ATTENDANCE_TYPES.flatMap((type) =>
    ATTENDANCE_STATUSES.map(
      (status) =>
        [type, status, STATUSES_BY_TYPE[type].includes(status) ? 'accepted' : 'refused'] as const,
    ),
  );

  it('asks all eighteen cells, so the table below is not vacuous', () => {
    expect(answer.size).toBe(ATTENDANCE_TYPES.length * ATTENDANCE_STATUSES.length);
    expect(answer.size).toBe(18);
  });

  it.each(cells)('%s + %s is %s', (type, status, expected) => {
    expect(answer.get(cell(type, status))).toBe(expected);
  });

  it('refuses a status the enum gains later, for every kind, until someone allows it', async () => {
    // The reason the constraint is an allow-list. Written as an exclusion of
    // STUDENT + LEAVE, it matched the matrix only because LEAVE happens to be the
    // one refused cell today; a new status would have been accepted for all
    // three kinds without anyone deciding that. ADD VALUE cannot run inside a
    // transaction that then uses the value, so it runs on its own first.
    await owner.query(`ALTER TYPE attendance_status_enum ADD VALUE IF NOT EXISTS 'REMOTE'`);

    await askDatabase(['REMOTE']);

    for (const type of ATTENDANCE_TYPES) {
      expect(answer.get(cell(type, 'REMOTE'))).toBe('refused');
    }
  });
});
