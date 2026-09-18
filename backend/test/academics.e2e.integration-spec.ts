// Must come first: see the module for why.
import { APP_ROLE_PASSWORD } from './app-database.env';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from 'jose';
import { DataSource } from 'typeorm';
// Namespace import with a runtime unwrap: supertest is CommonJS with a default
// export and this tsconfig has esModuleInterop off, the same reason the route
// conformance suite imports it this way.
import * as supertestModule from 'supertest';

import { AppModule } from '../src/app.module';
import { Role } from '../src/auth/permission.matrix';
import { SupabaseTokenVerifier } from '../src/auth/token-verifier';
import { createTestDataSource, resetSchema } from './database.setup';
import { seedMember } from './people.fixtures';

type SupertestFn = typeof supertestModule;
const maybeWrapped = supertestModule as unknown as { default?: SupertestFn };
const request: SupertestFn = maybeWrapped.default ?? supertestModule;

/**
 * The whole chain, composed, over HTTP.
 *
 * Every layer has its own suite: the guard, the resolver, the permission check,
 * the access scope and row-level security. None of those can catch a mistake in
 * how the layers hand off to each other, such as the role resolved from a
 * membership never reaching the scope, and every layer test would stay green if
 * that happened. This is the first automated proof that the pieces compose.
 *
 * Real application, real guard, real verifier doing real signature checks, real
 * Postgres connected as `cyberschola_app`. The only substitution is where the
 * verifier fetches keys from: a local server with a keypair this suite generated,
 * instead of Supabase. Environment validation still requires https for the JWKS
 * URL and is not weakened for this; the verifier instance is replaced instead,
 * so the class under test is unchanged.
 */
describe('academics end to end', () => {
  let owner: DataSource;
  let app: INestApplication;
  let keyServer: Server;
  let privateKey: KeyLike;

  const ISSUER = 'https://e2e-placeholder.supabase.co/auth/v1';
  const KID = 'e2e-key';

  const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const OTHER_SCHOOL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const users = {
    admin: '10000000-0000-4000-8000-000000000001',
    teacher: '10000000-0000-4000-8000-000000000002',
    idleTeacher: '10000000-0000-4000-8000-000000000003',
    student: '10000000-0000-4000-8000-000000000004',
    otherStudent: '10000000-0000-4000-8000-000000000005',
    otherSchoolAdmin: '10000000-0000-4000-8000-000000000006',
  } as const;

  const studentIds: Record<'student' | 'otherStudent', string> = { student: '', otherStudent: '' };
  let session: string;
  let grade: string;

  const server = (): Server => app.getHttpServer() as Server;

  /** The response shapes this suite reads, typed once rather than cast at each use. */
  interface PageBody {
    data: { items: Array<{ id: string }>; total: number };
  }
  interface ClassBody {
    data: { arm: string };
  }
  const body = <T>(response: { body: unknown }): T => response.body as T;

  async function tokenFor(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: KID })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
  }

  async function ownerInsert(sql: string, params: unknown[]): Promise<string> {
    const [row] = await owner.query<Array<{ id: string }>>(sql, params);
    return row.id;
  }

  beforeAll(async () => {
    // Keys, served the way Supabase serves them.
    const pair = await generateKeyPair('ES256');
    privateKey = pair.privateKey;
    const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' };
    keyServer = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) => keyServer.listen(0, '127.0.0.1', resolve));
    const jwksUrl = `http://127.0.0.1:${(keyServer.address() as AddressInfo).port}/keys`;

    // Schema and seed, as the owner.
    owner = createTestDataSource();
    await owner.initialize();
    await resetSchema(owner);
    await owner.runMigrations({ transaction: 'all' });
    await owner.query(`ALTER ROLE cyberschola_app WITH PASSWORD '${APP_ROLE_PASSWORD}'`);
    await owner.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Greenfield', 'greenfield'), ($2, 'Brookvale', 'brookvale')`,
      [SCHOOL, OTHER_SCHOOL],
    );

    // A role is the role row on a membership, so seeding "a teacher" means a
    // membership plus a teachers row.
    await seedMember(owner, SCHOOL, users.admin, [Role.SchoolAdmin]);
    const teacher = (await seedMember(owner, SCHOOL, users.teacher, [Role.Teacher])).roleRows[
      Role.Teacher
    ]!;
    await seedMember(owner, SCHOOL, users.idleTeacher, [Role.Teacher]);
    studentIds.student = (await seedMember(owner, SCHOOL, users.student, [Role.Student])).roleRows[
      Role.Student
    ]!;
    studentIds.otherStudent = (
      await seedMember(owner, SCHOOL, users.otherStudent, [Role.Student])
    ).roleRows[Role.Student]!;
    await seedMember(owner, OTHER_SCHOOL, users.otherSchoolAdmin, [Role.SchoolAdmin]);

    session = await ownerInsert(
      `INSERT INTO academic_sessions (tenant_id, name, starts_on, ends_on, is_current)
       VALUES ($1, '2026/2027', '2026-09-01', '2027-07-31', true) RETURNING id`,
      [SCHOOL],
    );
    await owner.query(
      `INSERT INTO terms (tenant_id, session_id, name, starts_on, ends_on)
       VALUES ($1, $2, 'First Term', '2026-09-01', '2026-12-15')`,
      [SCHOOL, session],
    );
    grade = await ownerInsert(
      `INSERT INTO grade_levels (tenant_id, name, position) VALUES ($1, 'JSS 2', 8) RETURNING id`,
      [SCHOOL],
    );
    const jss2a = await ownerInsert(
      `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm) VALUES ($1, $2, $3, 'A') RETURNING id`,
      [SCHOOL, session, grade],
    );
    const jss2b = await ownerInsert(
      `INSERT INTO classes (tenant_id, session_id, grade_level_id, arm) VALUES ($1, $2, $3, 'B') RETURNING id`,
      [SCHOOL, session, grade],
    );

    // The teacher supervises JSS2A only. The student is there; the other student
    // is in JSS2B, where this teacher has nothing.
    await owner.query(
      `INSERT INTO class_supervisors (tenant_id, class_id, teacher_id) VALUES ($1, $2, $3)`,
      [SCHOOL, jss2a, teacher],
    );
    await owner.query(
      `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id) VALUES ($1, $2, $3, $4)`,
      [SCHOOL, jss2a, session, studentIds.student],
    );
    await owner.query(
      `INSERT INTO class_enrolments (tenant_id, class_id, session_id, student_id) VALUES ($1, $2, $3, $4)`,
      [SCHOOL, jss2b, session, studentIds.otherStudent],
    );

    // The application. Its connection was pointed at the restricted role by
    // app-database.env before anything else loaded.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseTokenVerifier)
      .useValue(new SupabaseTokenVerifier(jwksUrl, ISSUER))
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    // Guard the guard: if the app is not the restricted role, this suite proves
    // nothing about the tenant boundary.
    const [{ role }] = await app
      .get(DataSource)
      .query<Array<{ role: string }>>('SELECT current_user AS role');
    expect(role).toBe('cyberschola_app');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (owner?.isInitialized) await owner.destroy();
    await new Promise<void>((resolve) => keyServer?.close(() => resolve()));
  });

  const asUser = async (userId: string) => `Bearer ${await tokenFor(userId)}`;

  const idsIn = (response: { body: unknown }) =>
    body<PageBody>(response)
      .data.items.map((item) => item.id)
      .sort();

  describe('the teacher rule, through the real request path', () => {
    it('gives an administrator every student in the school', async () => {
      const response = await request(server())
        .get('/api/v1/students')
        .set('authorization', await asUser(users.admin))
        .expect(200);

      expect(idsIn(response)).toEqual([studentIds.student, studentIds.otherStudent].sort());
    });

    it('gives a teacher only the students in the class they supervise', async () => {
      // The claim the architecture rests on, end to end: token verified, tenant
      // and role resolved from the membership, permission granted, scope applied,
      // policies enforced, and exactly this teacher's students come back.
      const response = await request(server())
        .get('/api/v1/students')
        .set('authorization', await asUser(users.teacher))
        .expect(200);

      expect(idsIn(response)).toEqual([studentIds.student]);
      expect(body<PageBody>(response).data.total).toBe(1);
    });

    it('gives a teacher with no assignments an empty list, not an error', async () => {
      const response = await request(server())
        .get('/api/v1/students')
        .set('authorization', await asUser(users.idleTeacher))
        .expect(200);

      expect(body<PageBody>(response).data.items).toEqual([]);
      expect(body<PageBody>(response).data.total).toBe(0);
    });
  });

  describe('permissions, through the real request path', () => {
    it('gives a student only themselves on the student list', async () => {
      // Blueprint section 16. Students hold student.read since BE-P01, and the
      // scope narrows it to their own record.
      const response = await request(server())
        .get('/api/v1/students')
        .set('authorization', await asUser(users.student))
        .expect(200);

      expect(idsIn(response)).toEqual([studentIds.student]);
    });

    it('refuses a teacher the people management routes', async () => {
      await request(server())
        .post('/api/v1/students')
        .set('authorization', await asUser(users.teacher))
        .send({ firstName: 'Ada', lastName: 'Obi' })
        .expect(403);
    });

    it('refuses a teacher permission to create a class', async () => {
      await request(server())
        .post('/api/v1/classes')
        .set('authorization', await asUser(users.teacher))
        .send({ sessionId: session, gradeLevelId: grade, arm: 'Z' })
        .expect(403);
    });

    it('lets any member read the academic structure', async () => {
      const response = await request(server())
        .get('/api/v1/classes')
        .set('authorization', await asUser(users.student))
        .expect(200);

      expect(body<PageBody>(response).data.total).toBe(2);
    });

    it('refuses everything without a token', async () => {
      await request(server()).get('/api/v1/students').expect(401);
    });
  });

  describe('writes, and the database refusing bad ones', () => {
    it('lets an administrator create a class', async () => {
      const response = await request(server())
        .post('/api/v1/classes')
        .set('authorization', await asUser(users.admin))
        .send({ sessionId: session, gradeLevelId: grade, arm: 'C' })
        .expect(201);

      expect(body<ClassBody>(response).data.arm).toBe('C');
    });

    it('reports a duplicate class as 409, not 500', async () => {
      // Before the constraint mapping in the exception filter, this was a 500.
      await request(server())
        .post('/api/v1/classes')
        .set('authorization', await asUser(users.admin))
        .send({ sessionId: session, gradeLevelId: grade, arm: 'a' })
        .expect(409);
    });

    it('reports an overlapping term as 409', async () => {
      await request(server())
        .post('/api/v1/terms')
        .set('authorization', await asUser(users.admin))
        .send({ sessionId: session, name: 'Overlap', startsOn: '2026-12-01', endsOn: '2027-02-01' })
        .expect(409);
    });

    it('reports a term outside its session as 422', async () => {
      await request(server())
        .post('/api/v1/terms')
        .set('authorization', await asUser(users.admin))
        .send({ sessionId: session, name: 'Stray', startsOn: '2027-07-01', endsOn: '2027-09-30' })
        .expect(422);
    });

    it('never leaks a constraint or table name in the error', async () => {
      const response = await request(server())
        .post('/api/v1/classes')
        .set('authorization', await asUser(users.admin))
        .send({ sessionId: session, gradeLevelId: grade, arm: 'A' })
        .expect(409);

      const text = JSON.stringify(response.body);
      for (const leak of ['classes_session_grade_arm_unique_live', 'duplicate key', 'Key (']) {
        expect(text).not.toContain(leak);
      }
    });
  });

  describe('the tenant boundary, through the real request path', () => {
    it("does not let another school's administrator see our students", async () => {
      // Their membership resolves them into their own school, where there are no
      // students. Nothing of ours is reachable from there.
      const response = await request(server())
        .get('/api/v1/students')
        .set('authorization', await asUser(users.otherSchoolAdmin))
        .expect(200);

      expect(body<PageBody>(response).data.items).toEqual([]);
    });

    it('returns 404 when they name our school, identical to a school that does not exist', async () => {
      await request(server())
        .get('/api/v1/students')
        .set('authorization', await asUser(users.otherSchoolAdmin))
        .set('x-school-id', SCHOOL)
        .expect(404);
    });

    it('returns 404 when they try to enrol into our class', async () => {
      // A class in another school is not found, per decision 6A, rather than
      // forbidden, which would confirm it exists.
      const classes = await owner.query<Array<{ id: string }>>(
        `SELECT id FROM classes WHERE tenant_id = $1 LIMIT 1`,
        [SCHOOL],
      );

      await request(server())
        .post('/api/v1/class-enrolments')
        .set('authorization', await asUser(users.otherSchoolAdmin))
        .send({ classId: classes[0]?.id, studentId: studentIds.student })
        .expect(404);
    });
  });
});
