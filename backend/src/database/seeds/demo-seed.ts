import 'reflect-metadata';

import { DataSource, type EntityManager } from 'typeorm';

import { migrationDataSourceOptions } from '../data-source';
import { DEMO_OTHER_SCHOOL_ID, DEMO_SCHOOL_ID, DEMO_USERS } from './demo-users';

/**
 * Seeds the staging demo: Greenfield College, with a week of school in it, and
 * Brookvale Academy beside it so the tenant boundary has something to prove.
 *
 * Run it with the compiled output, as the database owner:
 *
 *   node dist/database/seeds/demo-seed.js
 *
 * It rebuilds both schools from nothing every time. Visitors to a public demo
 * sign in as an administrator and change things, so staging resets this on a
 * schedule, and a partial rerun that layered new rows over old ones would drift
 * away from what the demo page describes.
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
  table: 'teachers' | 'students' | 'parents' | 'staff',
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

async function seedGreenfield(manager: EntityManager): Promise<void> {
  const school = DEMO_SCHOOL_ID;

  await manager.query(
    `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Greenfield College', 'greenfield-demo')`,
    [school],
  );

  // People. Logins first, then the records that give each login its role.
  const adminMembership = await membership(manager, school, userId('admin'));
  await manager.query(`INSERT INTO school_admins (tenant_id, membership_id) VALUES ($1, $2)`, [
    school,
    adminMembership,
  ]);

  const adaeze = await person(
    manager,
    'teachers',
    school,
    await membership(manager, school, userId('teacher')),
    'Adaeze',
    'Okonkwo',
  );
  const obiMembership = await membership(manager, school, userId('teacherParent'));
  const obi = await person(manager, 'teachers', school, obiMembership, 'Obi', 'Nwosu');
  const obiAsParent = await person(manager, 'parents', school, obiMembership, 'Obi', 'Nwosu');
  const chidi = await person(manager, 'teachers', school, null, 'Chidi', 'Eze');
  const ngozi = await person(manager, 'teachers', school, null, 'Ngozi', 'Bello');
  const funmi = await person(
    manager,
    'parents',
    school,
    await membership(manager, school, userId('parent')),
    'Funmi',
    'Abubakar',
  );
  const bayo = await person(
    manager,
    'staff',
    school,
    await membership(manager, school, userId('staff')),
    'Bayo',
    'Adewale',
  );

  const zainab = await person(
    manager,
    'students',
    school,
    await membership(manager, school, userId('student')),
    'Zainab',
    'Abubakar',
  );
  const pupils = {
    zainab,
    kemi: await person(manager, 'students', school, null, 'Kemi', 'Adeyemi'),
    emeka: await person(manager, 'students', school, null, 'Emeka', 'Obi'),
    tunde: await person(manager, 'students', school, null, 'Tunde', 'Nwosu'),
    amara: await person(manager, 'students', school, null, 'Amara', 'Eze'),
    dami: await person(manager, 'students', school, null, 'Dami', 'Afolabi'),
  };

  await manager.query(
    `INSERT INTO guardianships (tenant_id, parent_id, student_id)
     VALUES ($1, $2, $3), ($1, $4, $5)`,
    [school, funmi, pupils.zainab, obiAsParent, pupils.tunde],
  );

  // The academic year.
  const session = await one(
    manager,
    `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
     VALUES ($1, '2026/2027', '2026-09-01', '2027-07-31', true) RETURNING id`,
    [school],
  );
  const term = await one(
    manager,
    `INSERT INTO terms (tenant_id, session_id, name, starts_on, ends_on)
     VALUES ($1, $2, 'First Term', '2026-09-07', '2026-12-18') RETURNING id`,
    [school, session],
  );
  const grade = await one(
    manager,
    `INSERT INTO grade_levels (tenant_id, name, position) VALUES ($1, 'JSS 2', 8) RETURNING id`,
    [school],
  );
  const classOf = (arm: string) =>
    one(
      manager,
      `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [school, session, grade, arm],
    );
  const jss2a = await classOf('A');
  const jss2b = await classOf('B');

  const subject = (name: string, code: string) =>
    one(manager, `INSERT INTO subjects (tenant_id, name, code) VALUES ($1, $2, $3) RETURNING id`, [
      school,
      name,
      code,
    ]);
  const maths = await subject('Mathematics', 'MTH');
  const english = await subject('English', 'ENG');
  const science = await subject('Basic Science', 'BSC');
  const french = await subject('French', 'FRE');
  const arabic = await subject('Arabic', 'ARA');

  // Who teaches what, and who is responsible for each class.
  await manager.query(
    `INSERT INTO class_supervisors (tenant_id, class_id, teacher_id) VALUES ($1, $2, $3), ($1, $4, $5)`,
    [school, jss2a, adaeze, jss2b, obi],
  );
  const teaches = (classId: string, subjectId: string, teacherId: string, elective = false) =>
    one(
      manager,
      `INSERT INTO class_subjects (tenant_id, class_id, subject_id, teacher_id, is_elective)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [school, classId, subjectId, teacherId, elective],
    );
  await teaches(jss2a, maths, adaeze);
  await teaches(jss2a, english, obi);
  await teaches(jss2a, science, chidi);
  const aFrench = await teaches(jss2a, french, chidi, true);
  const aArabic = await teaches(jss2a, arabic, ngozi, true);
  await teaches(jss2b, maths, adaeze);
  await teaches(jss2b, english, obi);
  await teaches(jss2b, science, ngozi);

  // Pupils in classes, and in the electives they chose.
  const enrolments: Record<string, { id: string; classId: string }> = {};

  for (const [name, classId] of [
    ['zainab', jss2a],
    ['kemi', jss2a],
    ['emeka', jss2a],
    ['tunde', jss2b],
    ['amara', jss2b],
    ['dami', jss2b],
  ] as const) {
    enrolments[name] = {
      classId,
      id: await one(
        manager,
        `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [school, classId, session, pupils[name]],
      ),
    };
  }

  await manager.query(
    `INSERT INTO elective_registrations (tenant_id, class_subject_id, student_id)
     VALUES ($1, $2, $3), ($1, $2, $4), ($1, $5, $4), ($1, $5, $6)`,
    [school, aFrench, pupils.zainab, pupils.kemi, aArabic, pupils.emeka],
  );

  // Registers for Monday to Thursday of the second week of term, mostly
  // present, so reports and the records list have something to show.
  const days = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'];
  const absent = new Set(['kemi@2026-09-15', 'amara@2026-09-16']);
  const late = new Set(['emeka@2026-09-14', 'dami@2026-09-17']);

  for (const date of days) {
    for (const [name, enrolment] of Object.entries(enrolments)) {
      const key = `${name}@${date}`;
      const status = absent.has(key) ? 'ABSENT' : late.has(key) ? 'LATE' : 'PRESENT';

      await manager.query(
        `INSERT INTO attendance
           (tenant_id, attendance_type, date, status, marked_by,
            student_id, enrolment_id, class_id, session_id, term_id)
         VALUES ($1, 'STUDENT', $2::date, $3, $4, $5, $6, $7, $8, $9)`,
        [
          school,
          date,
          status,
          adminMembership,
          pupils[name as keyof typeof pupils],
          enrolment.id,
          enrolment.classId,
          session,
          term,
        ],
      );
    }

    // Employees' days carry no class, session or term: those describe a pupil's
    // enrolment, and the table's check refuses them on anyone else's record.
    for (const [column, id] of [
      ['teacher_id', adaeze],
      ['staff_id', bayo],
    ] as const) {
      await manager.query(
        `INSERT INTO attendance (tenant_id, attendance_type, date, status, marked_by, ${column})
         VALUES ($1, $2, $3::date, 'PRESENT', $4, $5)`,
        [school, column === 'teacher_id' ? 'TEACHER' : 'STAFF', date, adminMembership, id],
      );
    }
  }
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
     VALUES ($1, '2026/2027', '2026-09-01', '2027-07-31', true) RETURNING id`,
    [school],
  );
  const grade = await one(
    manager,
    `INSERT INTO grade_levels (tenant_id, name, position) VALUES ($1, 'JSS 1', 7) RETURNING id`,
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

export async function seedDemo(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (manager) => {
    // Everything a school owns references it with ON DELETE CASCADE, so
    // removing the two schools removes every row the last run created.
    await manager.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
      [DEMO_SCHOOL_ID, DEMO_OTHER_SCHOOL_ID],
    ]);
    await seedGreenfield(manager);
    await seedBrookvale(manager);
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
    console.log('Demo schools seeded: Greenfield College and Brookvale Academy.');
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
