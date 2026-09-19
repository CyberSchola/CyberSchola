import type { DataSource } from 'typeorm';

/**
 * Seeding the timetable's world as the owner: sessions, classes, subjects, the
 * class subjects that say who teaches what, periods and lessons.
 *
 * As the owner on purpose, like every fixture: fixtures describe the world, and
 * the suites prove what the application role can and cannot do in it. A lesson
 * is seeded with its copies read from its class subject and period, which is how
 * the service makes one, so a fixture can never describe a lesson the schema
 * would refuse.
 */

async function insertOne(owner: DataSource, sql: string, params: unknown[]): Promise<string> {
  const [row] = await owner.query<Array<{ id: string }>>(sql, params);

  return row.id;
}

export function seedSession(
  owner: DataSource,
  tenantId: string,
  options: { name: string; startsOn: string; endsOn: string; current: boolean },
): Promise<string> {
  return insertOne(
    owner,
    `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, options.name, options.startsOn, options.endsOn, options.current],
  );
}

/** A class, with its grade level created on first use for the school. */
export async function seedClass(
  owner: DataSource,
  tenantId: string,
  sessionId: string,
  grade: string,
  arm: string,
): Promise<string> {
  const [existing] = await owner.query<Array<{ id: string }>>(
    `SELECT id FROM grade_levels WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`,
    [tenantId, grade],
  );
  const gradeId =
    existing?.id ??
    (await insertOne(
      owner,
      `INSERT INTO grade_levels (tenant_id, name, position)
       VALUES ($1, $2, (SELECT count(*) FROM grade_levels WHERE tenant_id = $1)) RETURNING id`,
      [tenantId, grade],
    ));

  return insertOne(
    owner,
    `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, sessionId, gradeId, arm],
  );
}

export function seedSubject(owner: DataSource, tenantId: string, name: string): Promise<string> {
  return insertOne(owner, `INSERT INTO subjects (tenant_id, name) VALUES ($1, $2) RETURNING id`, [
    tenantId,
    name,
  ]);
}

export function seedClassSubject(
  owner: DataSource,
  tenantId: string,
  options: { classId: string; subjectId: string; teacherId: string; elective?: boolean },
): Promise<string> {
  return insertOne(
    owner,
    `INSERT INTO class_subjects (tenant_id, class_id, subject_id, teacher_id, is_elective)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, options.classId, options.subjectId, options.teacherId, options.elective ?? false],
  );
}

export function seedPeriod(
  owner: DataSource,
  tenantId: string,
  options: { sessionId: string; weekday: number; label: string; startsAt: string; endsAt: string },
): Promise<string> {
  return insertOne(
    owner,
    `INSERT INTO timetable_periods (tenant_id, session_id, weekday, label, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, options.sessionId, options.weekday, options.label, options.startsAt, options.endsAt],
  );
}

/** A lesson, with its session, class, teacher and electiveness taken from its sources. */
export function seedLesson(
  owner: DataSource,
  tenantId: string,
  options: { periodId: string; classSubjectId: string },
): Promise<string> {
  return insertOne(
    owner,
    `INSERT INTO timetable_lessons
       (tenant_id, session_id, period_id, class_id, class_subject_id, teacher_id, is_elective)
     SELECT $1, period.session_id, period.id, assignment.class_id, assignment.id,
            assignment.teacher_id, assignment.is_elective
       FROM timetable_periods period, class_subjects assignment
      WHERE period.id = $2 AND assignment.id = $3
     RETURNING id`,
    [tenantId, options.periodId, options.classSubjectId],
  );
}

export function enrol(
  owner: DataSource,
  tenantId: string,
  options: { classId: string; studentId: string },
): Promise<string> {
  return insertOne(
    owner,
    `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id)
     SELECT $1, id, session_id, $3 FROM classes WHERE id = $2 RETURNING id`,
    [tenantId, options.classId, options.studentId],
  );
}

export function register(
  owner: DataSource,
  tenantId: string,
  options: { classSubjectId: string; studentId: string },
): Promise<string> {
  return insertOne(
    owner,
    `INSERT INTO elective_registrations (tenant_id, class_subject_id, student_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, options.classSubjectId, options.studentId],
  );
}
