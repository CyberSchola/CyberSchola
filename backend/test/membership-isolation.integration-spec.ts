import { DataSource } from 'typeorm';

import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';

/**
 * The membership policy, verified as the role that actually serves traffic.
 *
 * This is the riskiest thing in BE-A01 and it has its own suite for that
 * reason. Every other tenant-owned table is protected by one predicate:
 * `tenant_id = current_tenant_id()`. This table cannot use it, because the
 * tenant is not known until this table has been read. Its policy is therefore
 * the only one in the system with an `OR` in it:
 *
 *     USING      (user_id = current_user_id() OR tenant_id = current_tenant_id())
 *     WITH CHECK (tenant_id = current_tenant_id())
 *
 * Two properties have to hold and neither is obvious by reading it:
 *
 * 1. The extra `OR` branch must not widen reads once a tenant *is* set. Acting
 *    in school A must not reveal school B, even though the user branch is now
 *    live alongside the tenant branch.
 * 2. `WITH CHECK` must not mirror `USING`. If it did, any authenticated user
 *    could insert a membership enrolling themselves in any school they named,
 *    and every isolation test in the system would still pass because the
 *    isolation would be working perfectly on a row they granted themselves.
 *
 * The second is a privilege escalation and is the reason the two clauses are
 * deliberately different. Both are pinned below.
 *
 * Everything runs as `cyberschola_app`. A suite that connected as the owner
 * would prove nothing: the owner is bound only because FORCE is set, and a
 * superuser bypasses policies regardless.
 */
describe('membership isolation', () => {
  /** Runs migrations and seeds. Connects as the owner. */
  let owner: DataSource;
  /** The restricted role the application uses. Policies bind to this one. */
  let app: DataSource;

  let schoolA: string;
  let schoolB: string;

  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';

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
    });
    await app.initialize();

    const rows = await owner.query<Array<{ id: string }>>(`
      INSERT INTO tenants (name, slug) VALUES
        ('Greenfield Academy', 'greenfield'),
        ('Brookvale School',   'brookvale')
      RETURNING id
    `);
    [schoolA, schoolB] = rows.map((row) => row.id) as [string, string];

    // Alice teaches at school A and parents at school B: the multi-school case.
    // Bob is only at school B, and exists so "another user's rows" is real.
    await owner.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES
         ($1, $3, 'TEACHER'),
         ($2, $3, 'PARENT'),
         ($2, $4, 'SCHOOL_ADMIN')`,
      [schoolA, schoolB, alice, bob],
    );
  }, 120_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  /** Runs a query as the app role with whichever session context is given. */
  async function asSession<T>(
    context: { userId?: string; tenantId?: string },
    sql: string,
    params: unknown[] = [],
  ): Promise<T> {
    return app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_user', $1, true)`, [
        context.userId ?? '',
      ]);
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [
        context.tenantId ?? '',
      ]);

      return manager.query<T>(sql, params);
    });
  }

  describe('the bootstrap read, with a user and no tenant', () => {
    it('returns the caller their own memberships', async () => {
      // The query the resolver runs. Without this the application cannot
      // authenticate anyone at all.
      const rows = await asSession<Array<{ tenant_id: string }>>(
        { userId: alice },
        `SELECT tenant_id FROM memberships`,
      );

      expect(rows.map((row) => row.tenant_id).sort()).toEqual([schoolA, schoolB].sort());
    });

    it('returns nothing belonging to another user', async () => {
      // Bob's SCHOOL_ADMIN row at school B must not appear for Alice, even
      // though Alice is also a member of school B.
      const rows = await asSession<Array<{ role: string }>>(
        { userId: alice },
        `SELECT role FROM memberships WHERE user_id = $1`,
        [bob],
      );

      expect(rows).toEqual([]);
    });

    it('returns nothing at all when no user is set either', async () => {
      // Both settings empty: the unauthenticated case. Fails closed.
      const rows = await asSession<unknown[]>({}, `SELECT * FROM memberships`);

      expect(rows).toEqual([]);
    });

    it('leaves every other tenant-owned table empty', async () => {
      // The user context is a narrow key that opens exactly one door. It must
      // not become a general-purpose way to read school data without a school.
      await owner.query(
        `INSERT INTO tenant_settings (tenant_id, setting_key, value)
         VALUES ($1, 'lessonNoteFormat', '{"style":"a"}')`,
        [schoolA],
      );

      const rows = await asSession<unknown[]>({ userId: alice }, `SELECT * FROM tenant_settings`);

      expect(rows).toEqual([]);
    });
  });

  describe('once a tenant is also set', () => {
    it('lets an administrator see that school’s memberships', async () => {
      // The other half of the OR, and the reason it exists: a school admin
      // listing the people in their school.
      const rows = await asSession<Array<{ user_id: string }>>(
        { userId: bob, tenantId: schoolB },
        `SELECT user_id FROM memberships`,
      );

      expect(rows.map((row) => row.user_id).sort()).toEqual([alice, bob].sort());
    });

    it('does not reveal another school while acting in one', async () => {
      // The case that only exists because of the OR, and the one that would
      // actually bite. Alice is a member of both schools, so her user branch
      // matches rows in school B while she is acting in school A. Those rows
      // are hers, which is why they are visible at all; what must not happen is
      // school A leaking *other people's* school B rows.
      const rows = await asSession<Array<{ tenant_id: string; user_id: string }>>(
        { userId: alice, tenantId: schoolA },
        `SELECT tenant_id, user_id FROM memberships WHERE user_id = $1`,
        [bob],
      );

      expect(rows).toEqual([]);
    });

    it('scopes every other tenant-owned table to the school, not to the user', async () => {
      const rows = await asSession<Array<{ tenant_id: string }>>(
        { userId: alice, tenantId: schoolA },
        `SELECT tenant_id FROM tenant_settings`,
      );

      expect(rows.every((row) => row.tenant_id === schoolA)).toBe(true);
    });
  });

  describe('writes, where USING and WITH CHECK deliberately differ', () => {
    it('refuses to let a user enrol themselves in a school they are not in', async () => {
      // The privilege escalation this design exists to prevent. If WITH CHECK
      // mirrored USING, this insert would succeed and the next request would
      // resolve Bob into school A with the isolation working perfectly on a
      // membership he granted himself.
      const outsider = '33333333-3333-4333-8333-333333333333';

      await expect(
        asSession(
          { userId: outsider },
          `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'SCHOOL_ADMIN')`,
          [schoolA, outsider],
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('refuses even when the caller does belong to some other school', async () => {
      // Alice is a real member of school A. That must not let her write a row
      // into school B's membership list while acting in school A.
      await expect(
        asSession(
          { userId: alice, tenantId: schoolA },
          `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'SCHOOL_ADMIN')`,
          [schoolB, alice],
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('allows a write inside the school being acted in', async () => {
      const newcomer = '44444444-4444-4444-8444-444444444444';

      await asSession(
        { userId: bob, tenantId: schoolB },
        `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'STUDENT')`,
        [schoolB, newcomer],
      );

      const rows = await asSession<unknown[]>(
        { userId: newcomer },
        `SELECT 1 FROM memberships WHERE user_id = $1`,
        [newcomer],
      );

      expect(rows).toHaveLength(1);
    });

    it('refuses to move a membership into another school', async () => {
      await expect(
        asSession(
          { userId: bob, tenantId: schoolB },
          `UPDATE memberships SET tenant_id = $1 WHERE user_id = $2`,
          [schoolA, bob],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe('the tenants table', () => {
    it('shows a caller only the schools they belong to', async () => {
      const rows = await asSession<Array<{ id: string }>>(
        { userId: bob },
        `SELECT id FROM tenants`,
      );

      expect(rows.map((row) => row.id)).toEqual([schoolB]);
    });

    it('shows nothing to an unauthenticated session', async () => {
      // Before this migration the table had no policy at all, so any
      // authenticated request could have listed every school in the system.
      const rows = await asSession<unknown[]>({}, `SELECT * FROM tenants`);

      expect(rows).toEqual([]);
    });

    it('does not let a caller rename a school they are not acting in', async () => {
      await expect(
        asSession({ userId: bob, tenantId: schoolB }, `UPDATE tenants SET name = 'Renamed'`, []),
      ).resolves.not.toThrow();

      const stillNamed = await owner.query<Array<{ name: string }>>(
        `SELECT name FROM tenants WHERE id = $1`,
        [schoolA],
      );

      // School A is untouched: the UPDATE above could only ever see school B.
      expect(stillNamed[0]?.name).toBe('Greenfield Academy');
    });
  });

  describe('the session context does not outlive its transaction', () => {
    it('does not leak the user onto the next transaction on the same connection', async () => {
      // The failure mode SET LOCAL exists to prevent. Under the transaction
      // pooler this connection goes straight to the next caller, and a
      // persisted setting would hand them somebody else's identity.
      await asSession({ userId: alice }, `SELECT 1`);

      const rows = await app.query<unknown[]>(`SELECT * FROM memberships`);

      expect(rows).toEqual([]);
    });

    it('reports no user id once the transaction has ended', async () => {
      await asSession({ userId: alice }, `SELECT 1`);

      const [row] = await app.query<Array<{ id: string | null }>>(`SELECT current_user_id() AS id`);

      expect(row?.id).toBeNull();
    });
  });
});
