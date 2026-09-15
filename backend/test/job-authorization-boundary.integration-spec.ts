import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { DataSource } from 'typeorm';

import { Permission, Role } from '../src/auth/permission.matrix';
import { PermissionInterceptor } from '../src/auth/permission.interceptor';
import { REQUIRES_PERMISSION_KEY } from '../src/auth/requires-permission.decorator';
import { ListMembersAction } from '../src/identity/list-members.action';
import { getRequestContext, runInJobContext } from '../src/tenancy/request-context';
import { JobContextService } from '../src/tenancy/job-context.service';
import { TenantTransactionService } from '../src/tenancy/tenant-transaction.service';
import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';

/**
 * The authorization boundary for work that is not an HTTP request.
 *
 * `PermissionInterceptor` skips non-HTTP execution, because a queue or RPC
 * handler has no route and therefore no route metadata to read. The question
 * this suite answers is whether that skip is a hole.
 *
 * It is not, and the reason is that the route permission is not the boundary
 * for background work. `TenantScopedAction` reads the tenant and the role from
 * a context that only two things open: the HTTP interceptor, after
 * authenticating and resolving a membership, or `runInJobContext`, called
 * deliberately with a school, an actor and a role. A job that opened neither
 * gets an exception rather than an unscoped query.
 *
 * Written against real Postgres as `cyberschola_app`, because the claim is
 * about what rows come back, and a mock would answer whatever it was told to.
 */
describe('the job authorization boundary', () => {
  let owner: DataSource;
  let app: DataSource;

  let school: string;
  let otherSchool: string;
  /** The verified entry point a real job would use. */
  let jobs: JobContextService;

  const admin = '11111111-1111-4111-8111-111111111111';
  const teacher = '22222222-2222-4222-8222-222222222222';
  const outsider = '33333333-3333-4333-8333-333333333333';

  const APP_PASSWORD = 'app_role_local_only';

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
      logging: ['error'],
      entities: ['src/**/*.entity.ts'],
    });
    await app.initialize();
    jobs = new JobContextService(new TenantTransactionService(app));

    const rows = await owner.query<Array<{ id: string }>>(`
      INSERT INTO tenants (name, slug) VALUES
        ('Greenfield Academy', 'greenfield'),
        ('Brookvale School', 'brookvale')
      RETURNING id
    `);
    [school, otherSchool] = rows.map((row) => row.id) as [string, string];

    await owner.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES
         ($1, $2, 'SCHOOL_ADMIN'),
         ($1, $3, 'TEACHER'),
         ($4, $5, 'SCHOOL_ADMIN')`,
      [school, admin, teacher, otherSchool, outsider],
    );
  }, 120_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  /** Runs a tenant-sensitive action the way a worker would, inside a transaction. */
  async function listMembers(tenantId: string, userId: string) {
    return app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      return new ListMembersAction(manager).execute(50, 0);
    });
  }

  describe('a worker that opened no context at all', () => {
    it('cannot read tenant data, even with the database session set', async () => {
      // The case the review asked about. The session variables are set, so
      // row-level security would happily return this school's rows. The action
      // still refuses, because nothing established who is asking.
      await expect(listMembers(school, admin)).rejects.toThrow(/no request context/i);
    });

    it('fails with an error rather than an unscoped read', async () => {
      // The distinction that matters. Returning zero rows would be safe but
      // would look like an empty school; returning every row would be a leak.
      // Throwing is neither, and it happens on the first call rather than in
      // whatever the job did with the result.
      const outcome: unknown = await listMembers(school, admin).catch((error: unknown) => error);

      expect(outcome).toBeInstanceOf(Error);
      // The message has to say what is missing, or whoever hits this in a
      // worker at 3am will assume the school is empty.
      expect((outcome as Error).message).toMatch(/must run inside a request|job payload/i);
    });
  });

  describe('the permission interceptor passing a job through', () => {
    /** A non-HTTP execution context, as a queue handler would present. */
    const rpcContext = {
      getType: () => 'rpc',
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      getHandler: () => function handler() {},
      getClass: () => class Handler {},
    } as unknown as ExecutionContext;

    it('lets it through, as it must', async () => {
      // If this refused, every background job would be blocked by a check that
      // has no route to read.
      const reflector = new Reflector();
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const interceptor = new PermissionInterceptor(reflector);
      const next: CallHandler = { handle: () => of('ran') };

      await expect(firstValueFrom(interceptor.intercept(rpcContext, next))).resolves.toBe('ran');

      jest.restoreAllMocks();
    });

    it('grants nothing by doing so', async () => {
      // The invariant in one assertion. The interceptor waved this execution
      // through while a route permission was declared, and the work behind it
      // still cannot reach a row.
      const reflector = new Reflector();
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockImplementation((key: unknown) =>
          key === REQUIRES_PERMISSION_KEY ? Permission.MembershipRead : undefined,
        );
      const interceptor = new PermissionInterceptor(reflector);

      let reached: unknown;
      const next: CallHandler = {
        handle: () => {
          reached = listMembers(school, admin).catch((error: unknown) => error);
          return of('ran');
        },
      };

      await firstValueFrom(interceptor.intercept(rpcContext, next));
      jest.restoreAllMocks();

      expect(await reached).toBeInstanceOf(Error);
    });
  });

  describe('a job that opens a context deliberately', () => {
    it('reads the school it named, scoped to the role it named', async () => {
      const page = await runInJobContext(
        {
          jobName: 'nightly-roster-export',
          tenantId: school,
          userId: admin,
          role: Role.SchoolAdmin,
        },
        () => listMembers(school, admin),
      );

      expect(page.items.map((member) => member.userId).sort()).toEqual([admin, teacher].sort());
    });

    it('is narrowed by the access scope exactly as a request would be', async () => {
      // A job acting as a teacher gains nothing by being a job. This is the
      // property that stops "run it in a worker" becoming a way around the
      // access scope.
      const page = await runInJobContext(
        { jobName: 'teacher-digest', tenantId: school, userId: teacher, role: Role.Teacher },
        () => listMembers(school, teacher),
      );

      expect(page.items.map((member) => member.userId)).toEqual([teacher]);
      expect(page.total).toBe(1);
    });

    it('cannot name a school its actor does not belong to', async () => {
      // This is the case that made JobContextService exist. Going through the
      // low-level primitive, a job could assert any tenant and read it: RLS was
      // working exactly as designed, because the membership policy admits a row
      // when tenant_id matches the session, and the job had simply set the
      // session. The verified path refuses before any of that happens.
      await expect(
        jobs.runAsMember({ jobName: 'misaimed-job', tenantId: otherSchool, userId: admin }, () =>
          Promise.resolve('should not run'),
        ),
      ).rejects.toThrow(/no live membership/i);
    });

    it('takes the role from the membership rather than from the caller', async () => {
      // A job cannot claim to be an administrator. The role is read off the row,
      // so a teacher's job is scoped as a teacher no matter what it asks for.
      const seen = await jobs.runAsMember(
        { jobName: 'teacher-digest', tenantId: school, userId: teacher },
        () => Promise.resolve(getRequestContext()?.role),
      );

      expect(seen).toBe(Role.Teacher);
    });

    it('scopes a verified job exactly as a request would be scoped', async () => {
      const page = await jobs.runAsMember(
        { jobName: 'teacher-digest', tenantId: school, userId: teacher },
        (manager) => new ListMembersAction(manager).execute(50, 0),
      );

      expect(page.items.map((member) => member.userId)).toEqual([teacher]);
      expect(page.total).toBe(1);
    });

    it('records what it was, so an audit can tell a job from a person', () => {
      const seen = runInJobContext(
        {
          jobName: 'nightly-roster-export',
          tenantId: school,
          userId: admin,
          role: Role.SchoolAdmin,
        },
        () => getRequestContext(),
      );

      expect(seen?.origin).toBe('job');
      expect(seen?.jobName).toBe('nightly-roster-export');
    });

    it('does not leave the context open afterwards', () => {
      runInJobContext(
        {
          jobName: 'nightly-roster-export',
          tenantId: school,
          userId: admin,
          role: Role.SchoolAdmin,
        },
        () => undefined,
      );

      expect(getRequestContext()).toBeUndefined();
    });
  });

  describe('a job context cannot be opened carelessly', () => {
    const valid = {
      jobName: 'job',
      tenantId: '11111111-2222-4333-8444-555555555555',
      userId: '22222222-3333-4444-8555-666666666666',
      role: Role.Teacher,
    };

    it('refuses an unnamed job', () => {
      expect(() => runInJobContext({ ...valid, jobName: '  ' }, () => undefined)).toThrow(
        /jobName/,
      );
    });

    it.each(['not-a-uuid', ''])('refuses a tenant id of %p', (tenantId) => {
      expect(() => runInJobContext({ ...valid, tenantId }, () => undefined)).toThrow(/tenant id/i);
    });

    it.each(['not-a-uuid', ''])('refuses a user id of %p', (userId) => {
      expect(() => runInJobContext({ ...valid, userId }, () => undefined)).toThrow(/user id/i);
    });

    it('refuses a role the matrix does not recognise', () => {
      // Fails closed exactly as the request path does. A job must not be the
      // route by which an unknown role gets in.
      expect(() =>
        runInJobContext({ ...valid, role: 'SUPER_ADMIN' as Role }, () => undefined),
      ).toThrow(/unrecognised role/i);
    });
  });
});
