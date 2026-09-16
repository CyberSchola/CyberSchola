// Must come first: it sets the database connection before the app loads.
import { type E2eHarness, request, startE2e } from './e2e.harness';

import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { DataSource } from 'typeorm';

import { Role } from '../src/auth/permission.matrix';
import { collectRoutes } from '../src/common/testing/route-inventory';
import { seedMember, seedRoleRow } from './people.fixtures';

/**
 * The people module over HTTP, and every one of its routes attacked from another
 * school.
 *
 * ## The cross-school sweep
 *
 * Blueprint section 49: a school A user sending school B's ids must fail. Rather
 * than a hand-written test per route, which the next route added would simply not
 * have, the sweep walks the application's own route inventory and requires a case
 * for every route the people controllers expose. A new route with no case fails
 * the build, and a case for a route that no longer exists fails too.
 */
describe('people end to end', () => {
  let e2e: E2eHarness;

  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const users = {
    adminA: '20000000-0000-4000-8000-000000000001',
    teacherA: '20000000-0000-4000-8000-000000000002',
    parentA: '20000000-0000-4000-8000-000000000003',
    studentA: '20000000-0000-4000-8000-000000000004',
    teacherParentA: '20000000-0000-4000-8000-000000000005',
    staffA: '20000000-0000-4000-8000-000000000006',
    newcomerA: '20000000-0000-4000-8000-000000000007',
    adminB: '20000000-0000-4000-8000-000000000011',
    newcomerB: '20000000-0000-4000-8000-000000000012',
  } as const;

  /** Ids in school A, set during seeding. */
  const a = {} as Record<
    | 'pupil'
    | 'child'
    | 'self'
    | 'ownChild'
    | 'tpPupil'
    | 'unrelated'
    | 'newcomerMembership'
    | 'teacherRecord'
    | 'parentRecord'
    | 'staffRecord',
    string
  >;

  /** Ids in school B: every kind of record the sweep aims at. */
  const b = {} as Record<
    'student' | 'teacher' | 'parent' | 'staff' | 'admin' | 'guardianship' | 'membership',
    string
  >;

  async function insert(owner: DataSource, sql: string, params: unknown[]): Promise<string> {
    const [row] = await owner.query<Array<{ id: string }>>(sql, params);
    return row.id;
  }

  beforeAll(async () => {
    e2e = await startE2e(
      async (owner) => {
        await owner.query(
          `INSERT INTO tenants (id, name, slug) VALUES
           ($1, 'Greenfield', 'greenfield'), ($2, 'Brookvale', 'brookvale')`,
          [A, B],
        );

        // School A. A teacher supervising JSS 1A, a parent of one child, a student
        // with a login, a teacher who is also a parent, staff, and a member with no
        // role yet.
        await seedMember(owner, A, users.adminA, [Role.SchoolAdmin]);
        const teacher = await seedMember(owner, A, users.teacherA, [Role.Teacher]);
        const parent = await seedMember(owner, A, users.parentA, [Role.Parent]);
        const self = await seedMember(owner, A, users.studentA, [Role.Student]);
        const teacherParent = await seedMember(owner, A, users.teacherParentA, [
          Role.Teacher,
          Role.Parent,
        ]);
        const staff = await seedMember(owner, A, users.staffA, [Role.Staff]);
        a.newcomerMembership = (await seedMember(owner, A, users.newcomerA, [])).membershipId;

        a.teacherRecord = teacher.roleRows[Role.Teacher]!;
        a.parentRecord = parent.roleRows[Role.Parent]!;
        a.staffRecord = staff.roleRows[Role.Staff]!;
        a.self = self.roleRows[Role.Student]!;
        a.pupil = await seedRoleRow(owner, A, Role.Student, null, { firstName: 'Pupil' });
        a.child = await seedRoleRow(owner, A, Role.Student, null, { firstName: 'Child' });
        a.ownChild = await seedRoleRow(owner, A, Role.Student, null, { firstName: 'Own' });
        a.tpPupil = await seedRoleRow(owner, A, Role.Student, null, { firstName: 'TpPupil' });
        a.unrelated = await seedRoleRow(owner, A, Role.Student, null, { firstName: 'Unrelated' });

        const session = await insert(
          owner,
          `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
         VALUES ($1, '2026/2027', '2026-09-01', '2027-07-31', true) RETURNING id`,
          [A],
        );
        const grade = await insert(
          owner,
          `INSERT INTO grade_levels (tenant_id, name, position) VALUES ($1, 'JSS 1', 7) RETURNING id`,
          [A],
        );
        const classFor = (arm: string) =>
          insert(
            owner,
            `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm) VALUES ($1, $2, $3, $4) RETURNING id`,
            [A, session, grade, arm],
          );
        const jss1a = await classFor('A');
        const jss1b = await classFor('B');
        const enrol = (classId: string, studentId: string) =>
          owner.query(
            `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id) VALUES ($1, $2, $3, $4)`,
            [A, classId, session, studentId],
          );
        await owner.query(
          `INSERT INTO class_supervisors (tenant_id, class_id, teacher_id) VALUES ($1, $2, $3), ($1, $4, $5)`,
          [A, jss1a, a.teacherRecord, jss1b, teacherParent.roleRows[Role.Teacher]],
        );
        await enrol(jss1a, a.pupil);
        await enrol(jss1b, a.tpPupil);

        await owner.query(
          `INSERT INTO guardianships (tenant_id, parent_id, student_id) VALUES ($1, $2, $3), ($1, $4, $5)`,
          [A, a.parentRecord, a.child, teacherParent.roleRows[Role.Parent], a.ownChild],
        );

        // School B: one of everything, as targets.
        b.admin = (await seedMember(owner, B, users.adminB, [Role.SchoolAdmin])).roleRows[
          Role.SchoolAdmin
        ]!;
        b.membership = (await seedMember(owner, B, users.newcomerB, [])).membershipId;
        b.student = await seedRoleRow(owner, B, Role.Student, null);
        b.teacher = await seedRoleRow(owner, B, Role.Teacher, null);
        b.parent = await seedRoleRow(owner, B, Role.Parent, null);
        b.staff = await seedRoleRow(owner, B, Role.Staff, null);
        b.guardianship = await insert(
          owner,
          `INSERT INTO guardianships (tenant_id, parent_id, student_id) VALUES ($1, $2, $3) RETURNING id`,
          [B, b.parent, b.student],
        );
      },
      [DiscoveryModule],
    );
  }, 180_000);

  afterAll(async () => {
    await e2e?.close();
  });

  const as = async (userId: string) => ({ authorization: await e2e.bearer(userId) });

  interface Item {
    id: string;
    view?: string;
    dateOfBirth?: unknown;
  }
  const items = (response: { body: unknown }) =>
    (response.body as { data: { items: Item[] } }).data.items;

  /** Whether a live row still exists and is unchanged in school B, read as the owner. */
  async function liveInB(table: string, id: string): Promise<boolean> {
    const rows = await e2e.owner.query<unknown[]>(
      `SELECT 1 FROM ${table} WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, B],
    );
    return rows.length === 1;
  }

  // -------------------------------------------------------------------------
  // The cross-school sweep
  // -------------------------------------------------------------------------

  describe("every people route, attacked with another school's ids", () => {
    const PEOPLE_CONTROLLERS = new Set([
      'StudentsController',
      'TeachersController',
      'ParentsController',
      'StaffController',
      'SchoolAdminsController',
      'GuardianshipsController',
    ]);

    /** The person routes share one shape, so their cases are generated per kind. */
    const personCases = (path: string, table: string, bId: () => string) => ({
      [`GET ${path}`]: async () => {
        const response = await request(e2e.server())
          .get(`/api/v1${path}`)
          .set(await as(users.adminA))
          .expect(200);
        expect(items(response).map((item) => item.id)).not.toContain(bId());
      },
      [`POST ${path}`]: async () => {
        // Nothing to aim at: a create cannot name a school. What must hold is
        // that the record lands in the caller's school and nowhere else.
        const response = await request(e2e.server())
          .post(`/api/v1${path}`)
          .set(await as(users.adminA))
          .send({ firstName: 'Sweep', lastName: 'Probe' })
          .expect(201);
        const id = (response.body as { data: { id: string } }).data.id;
        const [row] = await e2e.owner.query<Array<{ tenant_id: string }>>(
          `SELECT tenant_id FROM ${table} WHERE id = $1`,
          [id],
        );
        expect(row?.tenant_id).toBe(A);
      },
      [`PATCH ${path}/:id`]: async () => {
        await request(e2e.server())
          .patch(`/api/v1${path}/${bId()}`)
          .set(await as(users.adminA))
          .send({ firstName: 'Hijacked' })
          .expect(404);
        const [row] = await e2e.owner.query<Array<{ first_name: string }>>(
          `SELECT first_name FROM ${table} WHERE id = $1`,
          [bId()],
        );
        expect(row?.first_name).not.toBe('Hijacked');
      },
      [`DELETE ${path}/:id`]: async () => {
        await request(e2e.server())
          .delete(`/api/v1${path}/${bId()}`)
          .set(await as(users.adminA))
          .expect(404);
        expect(await liveInB(table, bId())).toBe(true);
      },
      [`PUT ${path}/:id/account`]: async () => {
        // Their record with our login, and our record with their login.
        const ours = {
          students: a.unrelated,
          teachers: a.teacherRecord,
          parents: a.parentRecord,
          staff: a.staffRecord,
        }[table]!;
        await request(e2e.server())
          .put(`/api/v1${path}/${bId()}/account`)
          .set(await as(users.adminA))
          .send({ membershipId: a.newcomerMembership })
          .expect(404);
        await request(e2e.server())
          .put(`/api/v1${path}/${ours}/account`)
          .set(await as(users.adminA))
          .send({ membershipId: b.membership })
          .expect(404);
      },
      [`DELETE ${path}/:id/account`]: async () => {
        await request(e2e.server())
          .delete(`/api/v1${path}/${bId()}/account`)
          .set(await as(users.adminA))
          .expect(404);
      },
    });

    const CASES: Record<string, () => Promise<void>> = {
      ...personCases('/students', 'students', () => b.student),
      [`GET /students/:id`]: async () => {
        await request(e2e.server())
          .get(`/api/v1/students/${b.student}`)
          .set(await as(users.adminA))
          .expect(404);
      },
      ...personCases('/teachers', 'teachers', () => b.teacher),
      ...personCases('/parents', 'parents', () => b.parent),
      ...personCases('/staff', 'staff', () => b.staff),
      'GET /school-admins': async () => {
        const response = await request(e2e.server())
          .get('/api/v1/school-admins')
          .set(await as(users.adminA))
          .expect(200);
        expect(items(response).map((item) => item.id)).not.toContain(b.admin);
      },
      'POST /school-admins': async () => {
        await request(e2e.server())
          .post('/api/v1/school-admins')
          .set(await as(users.adminA))
          .send({ membershipId: b.membership })
          .expect(404);
      },
      'DELETE /school-admins/:id': async () => {
        await request(e2e.server())
          .delete(`/api/v1/school-admins/${b.admin}`)
          .set(await as(users.adminA))
          .expect(404);
        expect(await liveInB('school_admins', b.admin)).toBe(true);
      },
      'GET /guardianships': async () => {
        const response = await request(e2e.server())
          .get('/api/v1/guardianships')
          .set(await as(users.adminA))
          .expect(200);
        expect(items(response).map((item) => item.id)).not.toContain(b.guardianship);
      },
      'POST /guardianships': async () => {
        // Their parent to our child, and our parent to their child.
        await request(e2e.server())
          .post('/api/v1/guardianships')
          .set(await as(users.adminA))
          .send({ parentId: b.parent, studentId: a.unrelated })
          .expect(404);
        await request(e2e.server())
          .post('/api/v1/guardianships')
          .set(await as(users.adminA))
          .send({ parentId: a.parentRecord, studentId: b.student })
          .expect(404);
      },
      'DELETE /guardianships/:id': async () => {
        await request(e2e.server())
          .delete(`/api/v1/guardianships/${b.guardianship}`)
          .set(await as(users.adminA))
          .expect(404);
        expect(await liveInB('guardianships', b.guardianship)).toBe(true);
      },
    };

    it('has a case for every people route, and none for a route that is gone', () => {
      const routes = collectRoutes(
        e2e.app.get(DiscoveryService),
        e2e.app.get(MetadataScanner),
        e2e.app.get(Reflector),
      )
        .filter((route) => PEOPLE_CONTROLLERS.has(route.controller))
        .map((route) => `${route.method} ${route.path}`)
        .sort();

      expect(routes.length).toBeGreaterThan(0);
      expect(routes).toEqual(Object.keys(CASES).sort());
    });

    it.each(Object.keys(CASES).sort())('%s', async (signature) => {
      await CASES[signature]();
    });
  });

  // -------------------------------------------------------------------------
  // Behaviour
  // -------------------------------------------------------------------------

  describe('who sees which students, and how much of each', () => {
    it('gives a teacher who is also a parent their pupil as a summary and their own child as a profile', async () => {
      const response = await request(e2e.server())
        .get('/api/v1/students')
        .set(await as(users.teacherParentA))
        .expect(200);

      const byId = new Map(items(response).map((item) => [item.id, item]));
      expect([...byId.keys()].sort()).toEqual([a.tpPupil, a.ownChild].sort());
      expect(byId.get(a.tpPupil)?.view).toBe('summary');
      expect(byId.get(a.tpPupil)).not.toHaveProperty('dateOfBirth');
      expect(byId.get(a.ownChild)?.view).toBe('profile');
      expect(byId.get(a.ownChild)).toHaveProperty('dateOfBirth');
    });

    it("answers a parent asking for somebody else's child with 404, not 403", async () => {
      await request(e2e.server())
        .get(`/api/v1/students/${a.unrelated}`)
        .set(await as(users.parentA))
        .expect(404);
    });

    it('refuses staff the student routes', async () => {
      await request(e2e.server())
        .get('/api/v1/students')
        .set(await as(users.staffA))
        .expect(403);
    });

    it("ends a parent's access the moment the guardianship is removed", async () => {
      const [link] = await e2e.owner.query<Array<{ id: string }>>(
        `SELECT id FROM guardianships WHERE parent_id = $1 AND student_id = $2`,
        [a.parentRecord, a.child],
      );

      await request(e2e.server())
        .get(`/api/v1/students/${a.child}`)
        .set(await as(users.parentA))
        .expect(200);

      await request(e2e.server())
        .delete(`/api/v1/guardianships/${link.id}`)
        .set(await as(users.adminA))
        .expect(200);

      await request(e2e.server())
        .get(`/api/v1/students/${a.child}`)
        .set(await as(users.parentA))
        .expect(404);
    });
  });

  describe('linking a login grants the role', () => {
    it('takes a member with no role from 403 to seeing themselves', async () => {
      await request(e2e.server())
        .get('/api/v1/students')
        .set(await as(users.newcomerA))
        .expect(403);

      const record = await request(e2e.server())
        .post('/api/v1/students')
        .set(await as(users.adminA))
        .send({ firstName: 'New', lastName: 'Comer' })
        .expect(201);
      const studentId = (record.body as { data: { id: string } }).data.id;

      await request(e2e.server())
        .put(`/api/v1/students/${studentId}/account`)
        .set(await as(users.adminA))
        .send({ membershipId: a.newcomerMembership })
        .expect(200);

      const response = await request(e2e.server())
        .get('/api/v1/students')
        .set(await as(users.newcomerA))
        .expect(200);

      expect(items(response).map((item) => item.id)).toEqual([studentId]);
    });

    it('refuses to link one login to two student records, with 409', async () => {
      const second = await request(e2e.server())
        .post('/api/v1/students')
        .set(await as(users.adminA))
        .send({ firstName: 'Second', lastName: 'Record' })
        .expect(201);

      await request(e2e.server())
        .put(`/api/v1/students/${(second.body as { data: { id: string } }).data.id}/account`)
        .set(await as(users.adminA))
        .send({ membershipId: a.newcomerMembership })
        .expect(409);
    });
  });

  describe('validation', () => {
    it('refuses to clear a required name with null, as a 400 rather than a database error', async () => {
      await request(e2e.server())
        .patch(`/api/v1/teachers/${a.teacherRecord}`)
        .set(await as(users.adminA))
        .send({ firstName: null })
        .expect(400);
    });

    it('refuses a blank name', async () => {
      await request(e2e.server())
        .post('/api/v1/parents')
        .set(await as(users.adminA))
        .send({ firstName: '   ', lastName: 'Blank' })
        .expect(400);
    });

    it('does not let a create payload link an account', async () => {
      // membershipId is not in the create DTO, so the whitelist refuses it.
      await request(e2e.server())
        .post('/api/v1/staff')
        .set(await as(users.adminA))
        .send({ firstName: 'Sly', lastName: 'Link', membershipId: a.newcomerMembership })
        .expect(400);
    });
  });

  describe('the last administrator', () => {
    it('cannot be removed', async () => {
      await request(e2e.server())
        .delete(`/api/v1/school-admins/${b.admin}`)
        .set(await as(users.adminB))
        .expect(409);
    });
  });
});
