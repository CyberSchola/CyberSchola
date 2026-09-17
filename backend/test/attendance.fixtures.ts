import type { DataSource } from 'typeorm';

import { Role } from '../src/auth/permission.matrix';
import type { AttendanceStatus, AttendanceType } from '../src/attendance/attendance.enums';
import { seedRoleRow } from './people.fixtures';

/**
 * A session, its term and a grade level, which nearly every attendance suite
 * needs before it can say anything at all.
 *
 * Seeded as the owner, like the rest of the fixtures: they describe the world,
 * and the suites then prove what the restricted role can see and do in it.
 */
export interface SeededYear {
  readonly sessionId: string;
  readonly termId: string;
  readonly gradeLevelId: string;
}

/** A class with its supervisor and its enrolled students. */
export interface SeededClass {
  readonly classId: string;
  readonly studentIds: readonly string[];
  /** The enrolment row per student, which attendance references. */
  readonly enrolmentIds: Readonly<Record<string, string>>;
}

/** A school day inside the seeded term, and safely in the past. */
export const TERM_STARTS_ON = '2026-09-01';
export const TERM_ENDS_ON = '2026-12-18';
export const SCHOOL_DAY = '2026-09-15';
/** A date in no term of the seeded session, for the date rule. */
export const HOLIDAY = '2026-08-10';

async function insert(owner: DataSource, sql: string, params: unknown[]): Promise<string> {
  const [row] = await owner.query<Array<{ id: string }>>(sql, params);

  return row.id;
}

/** The current session, one term inside it, and a grade level to hang classes on. */
export async function seedAcademicYear(
  owner: DataSource,
  tenantId: string,
  options: { readonly name?: string; readonly gradeLevel?: string } = {},
): Promise<SeededYear> {
  const sessionId = await insert(
    owner,
    `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
     VALUES ($1, $2, '2026-09-01', '2027-07-31', true) RETURNING id`,
    [tenantId, options.name ?? '2026/2027'],
  );

  const termId = await insert(
    owner,
    `INSERT INTO terms (tenant_id, session_id, name, starts_on, ends_on)
     VALUES ($1, $2, 'First Term', $3, $4) RETURNING id`,
    [tenantId, sessionId, TERM_STARTS_ON, TERM_ENDS_ON],
  );

  const gradeLevelId = await insert(
    owner,
    `INSERT INTO grade_levels (tenant_id, name, position) VALUES ($1, $2, 7) RETURNING id`,
    [tenantId, options.gradeLevel ?? 'JSS 1'],
  );

  return { sessionId, termId, gradeLevelId };
}

/**
 * A class in the seeded year, optionally supervised, with students enrolled.
 *
 * Students are created here when ids are not supplied, because most suites care
 * that there are five children in a class rather than who they are.
 */
export async function seedClass(
  owner: DataSource,
  tenantId: string,
  year: SeededYear,
  options: {
    readonly arm?: string;
    readonly supervisorTeacherId?: string;
    readonly students?: readonly string[];
    readonly studentCount?: number;
  } = {},
): Promise<SeededClass> {
  const classId = await insert(
    owner,
    `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, year.sessionId, year.gradeLevelId, options.arm ?? 'A'],
  );

  if (options.supervisorTeacherId !== undefined) {
    await owner.query(
      `INSERT INTO class_supervisors (tenant_id, class_id, teacher_id) VALUES ($1, $2, $3)`,
      [tenantId, classId, options.supervisorTeacherId],
    );
  }

  const studentIds = [...(options.students ?? [])];

  for (
    let index = studentIds.length;
    index < (options.studentCount ?? studentIds.length);
    index++
  ) {
    studentIds.push(
      await seedRoleRow(owner, tenantId, Role.Student, null, { firstName: `Pupil${index}` }),
    );
  }

  const enrolmentIds: Record<string, string> = {};

  for (const studentId of studentIds) {
    enrolmentIds[studentId] = await insert(
      owner,
      `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [tenantId, classId, year.sessionId, studentId],
    );
  }

  return { classId, studentIds, enrolmentIds };
}

/**
 * One attendance row, written as the owner.
 *
 * For the read suites, which need records to exist without going through the
 * endpoints that create them. The marking suites use the API instead, because
 * there the write path is what is under test.
 */
export async function seedAttendance(
  owner: DataSource,
  tenantId: string,
  record: {
    readonly type: AttendanceType;
    readonly status: AttendanceStatus;
    readonly markedBy: string;
    readonly date?: string;
    readonly studentId?: string;
    readonly teacherId?: string;
    readonly staffId?: string;
    readonly enrolmentId?: string;
    readonly classId?: string;
    readonly sessionId?: string;
    readonly termId?: string;
  },
): Promise<string> {
  return insert(
    owner,
    `INSERT INTO attendance
       (tenant_id, attendance_type, date, status, marked_by,
        student_id, teacher_id, staff_id, enrolment_id, class_id, session_id, term_id)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      tenantId,
      record.type,
      record.date ?? SCHOOL_DAY,
      record.status,
      record.markedBy,
      record.studentId ?? null,
      record.teacherId ?? null,
      record.staffId ?? null,
      record.enrolmentId ?? null,
      record.classId ?? null,
      record.sessionId ?? null,
      record.termId ?? null,
    ],
  );
}
