import 'reflect-metadata';

import { DataSource, type EntityManager } from 'typeorm';

import { migrationDataSourceOptions } from '../data-source';
import {
  absentDayIndexes,
  DEMO_ASSESSMENTS,
  DEMO_RESULTS,
  DEMO_SCHOOL,
  DEMO_STUDENTS,
  DEMO_SUBJECTS,
  demoTermSchoolDays,
} from './demo-dataset';
import { DEMO_OTHER_SCHOOL_ID, DEMO_SCHOOL_ID, DEMO_USERS } from './demo-users';

/**
 * Seeds the staging demo: CyberSchola Demo College, built from the hackathon
 * demo dataset in `demo-dataset.ts`, and Brookvale Academy beside it so the
 * tenant boundary has something to prove.
 *
 * Run it with the compiled output, as the database owner:
 *
 *   node dist/database/seeds/demo-seed.js
 *
 * It rebuilds both schools from nothing every time. Visitors to a public demo
 * sign in as an administrator and change things, so staging resets this on a
 * schedule, and a partial rerun that layered new rows over old ones would drift
 * away from the dataset.
 *
 * It refuses to run unless NODE_ENV is staging or development. The two schools
 * have fixed ids, and deleting a school by id is exactly the statement that must
 * never meet a production database.
 */

const ALLOWED_ENVIRONMENTS = new Set(['staging', 'development']);

const userId = (key: string): string => {
  const user = DEMO_USERS.find((candidate) => candidate.key === key);

  if (!user) {
    throw new Error(`No demo user "${key}".`);
  }

  return user.userId;
};

async function one(manager: EntityManager, sql: string, params: unknown[]): Promise<string> {
  const [row] = await manager.query<Array<{ id: string }>>(sql, params);

  return row.id;
}

async function membership(manager: EntityManager, tenantId: string, user: string) {
  return one(
    manager,
    `INSERT INTO memberships (tenant_id, user_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
    [tenantId, user],
  );
}

async function person(
  manager: EntityManager,
  table: 'teachers' | 'students',
  tenantId: string,
  membershipId: string | null,
  firstName: string,
  lastName: string,
) {
  return one(
    manager,
    `INSERT INTO ${table} (tenant_id, membership_id, first_name, last_name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, membershipId, firstName, lastName],
  );
}

/** Which demo people sign in as which teacher, by subject. */
const TEACHER_LOGINS: Partial<Record<(typeof DEMO_SUBJECTS)[number]['key'], string>> = {
  maths: 'mathsTeacher',
  physics: 'physicsTeacher',
};

/** The ids the rest of the seed, and the results seed after it, build on. */
export interface SeededDemoSchool {
  readonly adminMembershipId: string;
  readonly sessionId: string;
  readonly termId: string;
  readonly classId: string;
  readonly classSubjectIds: Readonly<Record<string, string>>;
  readonly enrolments: ReadonlyArray<{
    readonly studentId: string;
    readonly enrolmentId: string;
    readonly firstName: string;
    readonly lastName: string;
  }>;
}

async function seedDemoCollege(manager: EntityManager): Promise<SeededDemoSchool> {
  const school = DEMO_SCHOOL_ID;

  await manager.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)`, [
    school,
    DEMO_SCHOOL.name,
    DEMO_SCHOOL.slug,
  ]);

  const adminMembershipId = await membership(manager, school, userId('admin'));
  await manager.query(`INSERT INTO school_admins (tenant_id, membership_id) VALUES ($1, $2)`, [
    school,
    adminMembershipId,
  ]);

  // The academic year and the demo term.
  const sessionId = await one(
    manager,
    `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
     VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [school, DEMO_SCHOOL.session.name, DEMO_SCHOOL.session.startsOn, DEMO_SCHOOL.session.endsOn],
  );
  for (const term of [DEMO_SCHOOL.firstTerm, DEMO_SCHOOL.demoTerm]) {
    await manager.query(
      `INSERT INTO terms (tenant_id, session_id, name, starts_on, ends_on) VALUES ($1, $2, $3, $4, $5)`,
      [school, sessionId, term.name, term.startsOn, term.endsOn],
    );
  }
  const termId = await one(manager, `SELECT id FROM terms WHERE tenant_id = $1 AND name = $2`, [
    school,
    DEMO_SCHOOL.demoTerm.name,
  ]);

  const gradeId = await one(
    manager,
    `INSERT INTO grade_levels (tenant_id, name, position) VALUES ($1, $2, $3) RETURNING id`,
    [school, DEMO_SCHOOL.grade.name, DEMO_SCHOOL.grade.position],
  );
  const classId = await one(
    manager,
    `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm) VALUES ($1, $2, $3, $4) RETURNING id`,
    [school, sessionId, gradeId, DEMO_SCHOOL.arm],
  );

  // Five subjects, each taught in SS2 A by its teacher. Two teachers can sign in.
  const classSubjectIds: Record<string, string> = {};

  for (const subject of DEMO_SUBJECTS) {
    const subjectId = await one(
      manager,
      `INSERT INTO subjects (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id`,
      [school, subject.name, subject.code],
    );
    const login = TEACHER_LOGINS[subject.key];
    const teacherId = await person(
      manager,
      'teachers',
      school,
      login ? await membership(manager, school, userId(login)) : null,
      subject.teacher.firstName,
      subject.teacher.lastName,
    );

    classSubjectIds[subject.key] = await one(
      manager,
      `INSERT INTO class_subjects (tenant_id, class_id, subject_id, teacher_id, is_elective)
       VALUES ($1, $2, $3, $4, false) RETURNING id`,
      [school, classId, subjectId, teacherId],
    );
  }

  // The twelve pupils, enrolled in SS2 A. Daniel Okafor can sign in.
  const enrolments: Array<SeededDemoSchool['enrolments'][number]> = [];

  for (const student of DEMO_STUDENTS) {
    const isLogin = student.firstName === 'Daniel' && student.lastName === 'Okafor';
    const studentId = await person(
      manager,
      'students',
      school,
      isLogin ? await membership(manager, school, userId('student')) : null,
      student.firstName,
      student.lastName,
    );
    const enrolmentId = await one(
      manager,
      `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [school, classId, sessionId, studentId],
    );

    enrolments.push({
      studentId,
      enrolmentId,
      firstName: student.firstName,
      lastName: student.lastName,
    });
  }

  // A register for every school day of the demo term, one row per pupil per
  // day, matching each pupil's attendance figure exactly.
  const days = demoTermSchoolDays();

  for (const [index, student] of DEMO_STUDENTS.entries()) {
    if (student.attendancePercent === null) {
      continue;
    }

    const absent = absentDayIndexes(student.attendancePercent, days.length);
    const { studentId, enrolmentId } = enrolments[index];

    await manager.query(
      `INSERT INTO attendance
         (tenant_id, attendance_type, date, status, marked_by,
          student_id, enrolment_id, class_id, session_id, term_id)
       SELECT $1, 'STUDENT', day.date::date,
              (CASE WHEN day.ordinal - 1 = ANY($3::int[]) THEN 'ABSENT' ELSE 'PRESENT' END)::attendance_status_enum,
              $4, $5, $6, $7, $8, $9
         FROM unnest($2::text[]) WITH ORDINALITY AS day(date, ordinal)`,
      [
        school,
        days,
        [...absent],
        adminMembershipId,
        studentId,
        enrolmentId,
        classId,
        sessionId,
        termId,
      ],
    );
  }

  // Second Term results: CA1, CA2 and the exam for every subject, as the plan
  // gives them. Pupils the plan has no scores for get none.
  for (const enrolment of enrolments) {
    const scores = DEMO_RESULTS[`${enrolment.firstName} ${enrolment.lastName}`];

    if (scores === undefined) {
      continue;
    }

    for (const [subjectIndex, subject] of DEMO_SUBJECTS.entries()) {
      for (const [assessmentIndex, assessment] of DEMO_ASSESSMENTS.entries()) {
        await manager.query(
          `INSERT INTO results
             (tenant_id, student_id, enrolment_id, class_id, session_id, term_id,
              class_subject_id, subject_id, assessment_type, score, max_score,
              assessed_on, recorded_by)
           SELECT $1, $2, $3, $4, $5, $6, cs.id, cs.subject_id, $8, $9, $10, $11, $12
             FROM class_subjects cs WHERE cs.id = $7`,
          [
            school,
            enrolment.studentId,
            enrolment.enrolmentId,
            classId,
            sessionId,
            termId,
            classSubjectIds[subject.key],
            assessment.type,
            scores[subjectIndex][assessmentIndex],
            assessment.maxScore,
            assessment.assessedOn,
            adminMembershipId,
          ],
        );
      }
    }
  }

  return { adminMembershipId, sessionId, termId, classId, classSubjectIds, enrolments };
}

async function seedBrookvale(manager: EntityManager): Promise<void> {
  const school = DEMO_OTHER_SCHOOL_ID;

  await manager.query(
    `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Brookvale Academy', 'brookvale-demo')`,
    [school],
  );
  const adminMembership = await membership(manager, school, userId('otherSchoolAdmin'));
  await manager.query(`INSERT INTO school_admins (tenant_id, membership_id) VALUES ($1, $2)`, [
    school,
    adminMembership,
  ]);

  const session = await one(
    manager,
    `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
     VALUES ($1, '2025/2026', '2025-09-08', '2026-07-24', true) RETURNING id`,
    [school],
  );
  const grade = await one(
    manager,
    `INSERT INTO grade_levels (tenant_id, name, position) VALUES ($1, 'SS2', 11) RETURNING id`,
    [school],
  );
  const classId = await one(
    manager,
    `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm)
     VALUES ($1, $2, $3, 'A') RETURNING id`,
    [school, session, grade],
  );
  const pupil = await person(manager, 'students', school, null, 'Ife', 'Ogunleye');
  await manager.query(
    `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id)
     VALUES ($1, $2, $3, $4)`,
    [school, classId, session, pupil],
  );
}

export async function seedDemo(dataSource: DataSource): Promise<SeededDemoSchool> {
  return dataSource.transaction(async (manager) => {
    // Everything a school owns references it with ON DELETE CASCADE, so
    // removing the two schools removes every row the last run created.
    await manager.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
      [DEMO_SCHOOL_ID, DEMO_OTHER_SCHOOL_ID],
    ]);
    const demo = await seedDemoCollege(manager);
    await seedBrookvale(manager);

    return demo;
  });
}

async function main(): Promise<void> {
  const environment = process.env.NODE_ENV ?? 'development';

  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    throw new Error(
      `The demo seed only runs in staging or development, and NODE_ENV is "${environment}". ` +
        'It deletes two schools by id before recreating them.',
    );
  }

  const dataSource = new DataSource(migrationDataSourceOptions);
  await dataSource.initialize();

  try {
    await seedDemo(dataSource);
    console.log(`Demo schools seeded: ${DEMO_SCHOOL.name} and Brookvale Academy.`);
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
