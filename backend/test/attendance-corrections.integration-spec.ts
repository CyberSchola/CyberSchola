import { DataSource, type EntityManager } from 'typeorm';

import { AttendanceStatus, AttendanceType } from '../src/attendance/attendance.enums';
import { Role } from '../src/auth/permission.matrix';
import { seedAcademicYear, seedAttendance, seedClass, SCHOOL_DAY } from './attendance.fixtures';
import { APP_ROLE_PASSWORD } from './app-database.env';
import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';
import { seedMember } from './people.fixtures';

/**
 * Blueprint section 96, proved where a service bug cannot reach it.
 *
 * These statements are sent to the database directly, as `cyberschola_app`, with
 * no application code anywhere in the path. That is the point: the guarantee is
 * that attendance cannot change without a trail, and a test that goes through
 * `AttendanceService.correct` would only show that one method behaves, which is
 * exactly the shape of the three defects earlier phases found by building rather
 * than reviewing.
 */
describe('attendance corrections', () => {
  let owner: DataSource;
  let app: DataSource;

  const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ADMIN_USER = '40000000-0000-4000-8000-000000000001';
  const STRANGER_USER = '40000000-0000-4000-8000-000000000009';

  let adminMembership: string;
  let recordId: string;
  let year: Awaited<ReturnType<typeof seedAcademicYear>>;

  /** Runs work as the application role, inside the school, as a given user. */
  async function asApp<T>(
    userId: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [SCHOOL]);

      return work(manager);
    });
  }

  /** A fresh record to correct, so each test starts from PRESENT. */
  async function freshRecord(date: string): Promise<string> {
    const student = await seedClass(owner, SCHOOL, year, { arm: date, studentCount: 1 });

    return seedAttendance(owner, SCHOOL, {
      type: AttendanceType.Student,
      status: AttendanceStatus.Present,
      markedBy: adminMembership,
      date,
      studentId: student.studentIds[0],
      enrolmentId: student.enrolmentIds[student.studentIds[0]],
      classId: student.classId,
      sessionId: year.sessionId,
      termId: year.termId,
    });
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

    ({ membershipId: adminMembership } = await seedMember(owner, SCHOOL, ADMIN_USER, [
      Role.SchoolAdmin,
    ]));

    year = await seedAcademicYear(owner, SCHOOL);
    recordId = await freshRecord(SCHOOL_DAY);
  }, 120_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  it('refuses a status change that carries no reason', async () => {
    await expect(
      asApp(ADMIN_USER, (manager) =>
        manager.query(`UPDATE attendance SET status = 'ABSENT' WHERE id = $1`, [recordId]),
      ),
    ).rejects.toThrow(/without a reason/i);

    const [record] = await owner.query<Array<{ status: string }>>(
      `SELECT status FROM attendance WHERE id = $1`,
      [recordId],
    );

    // Refused, not merely unrecorded.
    expect(record.status).toBe('PRESENT');
  });

  it('records the previous status, the new one, the reason and who changed it', async () => {
    const id = await freshRecord('2026-09-16');

    await asApp(ADMIN_USER, async (manager) => {
      await manager.query(`SELECT set_config('app.attendance_reason', $1, true)`, [
        'Arrived during registration.',
      ]);
      await manager.query(`UPDATE attendance SET status = 'LATE' WHERE id = $1`, [id]);
    });

    const [trail] = await owner.query<
      Array<{
        previous_status: string;
        new_status: string;
        reason: string;
        changed_by: string;
        tenant_id: string;
      }>
    >(`SELECT * FROM attendance_corrections WHERE attendance_id = $1`, [id]);

    expect(trail).toMatchObject({
      previous_status: 'PRESENT',
      new_status: 'LATE',
      reason: 'Arrived during registration.',
      changed_by: adminMembership,
      tenant_id: SCHOOL,
    });
  });

  it('refuses a blank reason, which is the same as none', async () => {
    const id = await freshRecord('2026-09-14');

    await expect(
      asApp(ADMIN_USER, async (manager) => {
        await manager.query(`SELECT set_config('app.attendance_reason', '   ', true)`);
        await manager.query(`UPDATE attendance SET status = 'ABSENT' WHERE id = $1`, [id]);
      }),
    ).rejects.toThrow(/without a reason/i);
  });

  it('refuses a correction by someone who is not a member of that school', async () => {
    const id = await freshRecord('2026-09-11');

    // The tenant setting is what row-level security reads, so the policy lets
    // this update through. The trigger is what refuses it, because there is no
    // membership to attribute the change to.
    await expect(
      asApp(STRANGER_USER, async (manager) => {
        await manager.query(`SELECT set_config('app.attendance_reason', $1, true)`, ['Because.']);
        await manager.query(`UPDATE attendance SET status = 'ABSENT' WHERE id = $1`, [id]);
      }),
    ).rejects.toThrow(/member of the school/i);
  });

  it('writes nothing when an update leaves the status alone', async () => {
    const id = await freshRecord('2026-09-10');

    await asApp(ADMIN_USER, (manager) =>
      manager.query(`UPDATE attendance SET remarks = 'Sent a note' WHERE id = $1`, [id]),
    );

    const rows = await owner.query<unknown[]>(
      `SELECT 1 FROM attendance_corrections WHERE attendance_id = $1`,
      [id],
    );

    expect(rows).toHaveLength(0);
  });

  it('does not let the application role edit or delete the trail', async () => {
    const id = await freshRecord('2026-09-09');

    await asApp(ADMIN_USER, async (manager) => {
      await manager.query(`SELECT set_config('app.attendance_reason', $1, true)`, ['Miskeyed.']);
      await manager.query(`UPDATE attendance SET status = 'ABSENT' WHERE id = $1`, [id]);
    });

    await expect(
      asApp(ADMIN_USER, (manager) =>
        manager.query(`UPDATE attendance_corrections SET reason = 'Something else'`),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      asApp(ADMIN_USER, (manager) => manager.query(`DELETE FROM attendance_corrections`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it('refuses a record dated outside the term it names', async () => {
    const student = await seedClass(owner, SCHOOL, year, { arm: 'outside', studentCount: 1 });

    await expect(
      seedAttendance(owner, SCHOOL, {
        type: AttendanceType.Student,
        status: AttendanceStatus.Present,
        markedBy: adminMembership,
        // Inside the session, outside First Term.
        date: '2027-02-02',
        studentId: student.studentIds[0],
        enrolmentId: student.enrolmentIds[student.studentIds[0]],
        classId: student.classId,
        sessionId: year.sessionId,
        termId: year.termId,
      }),
    ).rejects.toThrow(/outside its term/i);
  });
  describe('who the trail can attribute a change to', () => {
    it('refuses a correction by a member whose membership is suspended', async () => {
      // A suspended member cannot reach the API, but the trigger is the guarantee
      // for every path, so it must not attribute a change to someone the school
      // has switched off.
      const user = '40000000-0000-4000-8000-000000000021';
      await seedMember(owner, SCHOOL, user, [Role.SchoolAdmin], { status: 'SUSPENDED' });
      const id = await freshRecord('2026-09-08');

      await expect(
        asApp(user, async (manager) => {
          await manager.query(`SELECT set_config('app.attendance_reason', $1, true)`, ['Why.']);
          await manager.query(`UPDATE attendance SET status = 'ABSENT' WHERE id = $1`, [id]);
        }),
      ).rejects.toThrow(/active member of the school/i);
    });

    it('refuses a correction by a member whose membership has been removed', async () => {
      const user = '40000000-0000-4000-8000-000000000022';
      await seedMember(owner, SCHOOL, user, [], { deleted: true });
      const id = await freshRecord('2026-09-07');

      await expect(
        asApp(user, async (manager) => {
          await manager.query(`SELECT set_config('app.attendance_reason', $1, true)`, ['Why.']);
          await manager.query(`UPDATE attendance SET status = 'ABSENT' WHERE id = $1`, [id]);
        }),
      ).rejects.toThrow(/active member of the school/i);
    });
  });
});
