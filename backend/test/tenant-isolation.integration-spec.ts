import { DataSource } from 'typeorm';

import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';

/**
 * Tenant isolation, enforced by Postgres and verified as the role that
 * actually serves traffic.
 *
 * This is the suite the whole architecture rests on. None of it can be tested
 * with a mocked repository, and more importantly none of it can be tested as
 * the owning role: the owner bypasses policies unless FORCE is set, so a suite
 * that only ever connects as the migration role would pass whether or not the
 * isolation exists. Every assertion below runs as `cyberschola_app`.
 */
describe('tenant isolation', () => {
  /** Runs migrations and seeds. Connects as the owner. */
  let owner: DataSource;
  /** The restricted role the application uses. Policies bind to this one. */
  let app: DataSource;

  let schoolA: string;
  let schoolB: string;

  const APP_PASSWORD = 'app_role_local_only';

  beforeAll(async () => {
    owner = createTestDataSource();
    await owner.initialize();
    await resetSchema(owner);
    await owner.runMigrations({ transaction: 'all' });

    // The migration deliberately sets no password, because a migration is
    // committed and a password in one lives in git forever. Setting it here is
    // the test-environment equivalent of the documented deploy step.
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
    [schoolA, schoolB] = rows.map((r) => r.id);

    await owner.query(
      `INSERT INTO tenant_settings (tenant_id, setting_key, value)
       VALUES ($1, 'lessonNoteFormat', '{"style":"a"}'), ($2, 'lessonNoteFormat', '{"style":"b"}')`,
      [schoolA, schoolB],
    );
  }, 120_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  /** Runs a query as the app role with a tenant context, the way the app does. */
  async function asTenant<T>(tenantId: string | null, sql: string, params: unknown[] = []) {
    return app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId ?? '']);
      return manager.query<T>(sql, params);
    });
  }

  describe('the connecting role', () => {
    it('is the restricted role, not the owner', async () => {
      const [row] = await app.query<Array<{ role: string }>>(`SELECT current_user AS role`);

      expect(row.role).toBe('cyberschola_app');
    });

    it('cannot bypass row-level security', async () => {
      // If this is ever true, every policy below becomes decoration and every
      // other test in this file passes for the wrong reason.
      const [row] = await app.query<Array<{ bypassrls: boolean; superuser: boolean }>>(
        `SELECT rolbypassrls AS bypassrls, rolsuper AS superuser
         FROM pg_roles WHERE rolname = current_user`,
      );

      expect(row.bypassrls).toBe(false);
      expect(row.superuser).toBe(false);
    });

    it('cannot alter a table, so it cannot switch its own policies off', async () => {
      await expect(
        app.query(`ALTER TABLE tenant_settings DISABLE ROW LEVEL SECURITY`),
      ).rejects.toThrow();
    });

    it('cannot drop the isolation policy', async () => {
      await expect(app.query(`DROP POLICY tenant_isolation ON tenant_settings`)).rejects.toThrow();
    });
  });

  describe('reads', () => {
    it('sees its own school', async () => {
      const rows = await asTenant<Array<{ tenant_id: string }>>(
        schoolA,
        `SELECT tenant_id FROM tenant_settings`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].tenant_id).toBe(schoolA);
    });

    it('cannot see another school, even asking for its id directly', async () => {
      // The whole point. School A holds a valid id for a real row in School B
      // and still gets nothing.
      const rows = await asTenant<unknown[]>(
        schoolA,
        `SELECT * FROM tenant_settings WHERE tenant_id = $1`,
        [schoolB],
      );

      expect(rows).toHaveLength(0);
    });

    it('cannot count another school either, so nothing leaks through an aggregate', async () => {
      const [row] = await asTenant<Array<{ count: string }>>(
        schoolA,
        `SELECT count(*)::text AS count FROM tenant_settings WHERE tenant_id = $1`,
        [schoolB],
      );

      expect(row.count).toBe('0');
    });

    it('returns nothing at all when no tenant context is set', async () => {
      // A query issued outside a tenant context must be a closed door. The
      // policy compares against NULL, which is never true.
      const rows = await asTenant<unknown[]>(null, `SELECT * FROM tenant_settings`);

      expect(rows).toHaveLength(0);
    });

    it('does not leak across transactions on a reused connection', async () => {
      // SET LOCAL is discarded at commit. A bare SET would persist on the
      // pooled connection and hand the next caller this tenant's context.
      await asTenant(schoolA, `SELECT 1`);

      const rows = await app.transaction((manager) =>
        manager.query<unknown[]>(`SELECT * FROM tenant_settings`),
      );

      expect(rows).toHaveLength(0);
    });
  });

  describe('writes', () => {
    it('can insert into its own school', async () => {
      await expect(
        asTenant(schoolA, `INSERT INTO tenant_settings (tenant_id, setting_key) VALUES ($1, $2)`, [
          schoolA,
          'timezone',
        ]),
      ).resolves.toBeDefined();
    });

    it('cannot insert a row stamped with another school', async () => {
      // WITH CHECK is what stops this. USING alone would filter reads and let
      // the write land, leaving a row the writer cannot see but which exists.
      await expect(
        asTenant(schoolA, `INSERT INTO tenant_settings (tenant_id, setting_key) VALUES ($1, $2)`, [
          schoolB,
          'smuggled',
        ]),
      ).rejects.toThrow(/row-level security/i);
    });

    it('cannot move one of its own rows into another school', async () => {
      await expect(
        asTenant(
          schoolA,
          `UPDATE tenant_settings SET tenant_id = $1 WHERE setting_key = 'lessonNoteFormat'`,
          [schoolB],
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('cannot update another school, and reports zero rows rather than erroring', async () => {
      const result = await asTenant<{ affected?: number }>(
        schoolA,
        `UPDATE tenant_settings SET value = '{"hacked":true}'::jsonb WHERE tenant_id = $1`,
        [schoolB],
      );

      // Invisible rows are not candidates for update, so this matches nothing.
      const untouched = await asTenant<Array<{ value: Record<string, unknown> }>>(
        schoolB,
        `SELECT value FROM tenant_settings WHERE setting_key = 'lessonNoteFormat'`,
      );

      expect(result).toBeDefined();
      expect(untouched[0].value).toEqual({ style: 'b' });
    });

    it('cannot delete another school', async () => {
      await asTenant(schoolA, `DELETE FROM tenant_settings WHERE tenant_id = $1`, [schoolB]);

      const survivors = await asTenant<unknown[]>(schoolB, `SELECT * FROM tenant_settings`);

      expect(survivors.length).toBeGreaterThan(0);
    });
  });

  describe('FORCE ROW LEVEL SECURITY', () => {
    it('is set, so policies bind to the table owner too', async () => {
      // Without FORCE, the owner reads everything. A deployment connecting as
      // the owner would then have no isolation while this whole suite still
      // passes, because the suite connects as the app role.
      const [row] = await owner.query<Array<{ forced: boolean; enabled: boolean }>>(
        `SELECT relforcerowsecurity AS forced, relrowsecurity AS enabled
         FROM pg_class WHERE relname = 'tenant_settings'`,
      );

      expect(row.enabled).toBe(true);
      expect(row.forced).toBe(true);
    });

    it('still does not constrain a superuser, which is why the app role is the real control', async () => {
      // Worth pinning, because it is the thing most likely to be assumed wrong.
      // FORCE makes policies bind to the table *owner*. It does nothing about a
      // superuser or a BYPASSRLS role: those bypass unconditionally.
      //
      // The migration connection here is the container superuser, and it reads
      // School B's row while sitting in School A's context. On Supabase the
      // equivalent is `postgres`, which migrations legitimately use.
      //
      // So FORCE is worth having, but it is the second line. The guarantee that
      // actually holds is decision 18A: the application connects as a role with
      // neither SUPERUSER nor BYPASSRLS. Everything above this block runs as
      // that role, which is what makes those assertions mean something.
      const [role] = await owner.query<Array<{ superuser: boolean }>>(
        `SELECT rolsuper AS superuser FROM pg_roles WHERE rolname = current_user`,
      );
      expect(role.superuser).toBe(true);

      const rows = await owner.transaction(async (manager) => {
        await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [schoolA]);
        return manager.query<unknown[]>(`SELECT * FROM tenant_settings WHERE tenant_id = $1`, [
          schoolB,
        ]);
      });

      expect(rows).toHaveLength(1);
    });

    it('binds a non-superuser owner, which is what FORCE is actually for', async () => {
      // Demonstrated by granting ownership to a plain role and reading as it.
      // Without FORCE this returns the row; with FORCE it returns nothing.
      await owner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_owner_probe') THEN
            CREATE ROLE rls_owner_probe WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'probe_local_only';
          END IF;
        END $$;
      `);
      await owner.query(`GRANT USAGE ON SCHEMA public TO rls_owner_probe`);
      await owner.query(`ALTER TABLE tenant_settings OWNER TO rls_owner_probe`);

      const url = new URL(integrationDatabaseUrl());
      url.username = 'rls_owner_probe';
      url.password = 'probe_local_only';
      const probe = new DataSource({
        type: 'postgres',
        url: url.toString(),
        ssl: false,
        logging: false,
      });
      await probe.initialize();

      try {
        const rows = await probe.transaction(async (manager) => {
          await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [schoolA]);
          return manager.query<unknown[]>(`SELECT * FROM tenant_settings WHERE tenant_id = $1`, [
            schoolB,
          ]);
        });

        expect(rows).toHaveLength(0);
      } finally {
        await probe.destroy();
        await owner.query(`ALTER TABLE tenant_settings OWNER TO CURRENT_USER`);
      }
    }, 60_000);
  });

  describe('partial unique indexes, per decision 8A', () => {
    it('rejects a duplicate key while the original is live', async () => {
      await expect(
        asTenant(schoolA, `INSERT INTO tenant_settings (tenant_id, setting_key) VALUES ($1, $2)`, [
          schoolA,
          'lessonNoteFormat',
        ]),
      ).rejects.toThrow(/duplicate key/i);
    });

    it('frees the key once the original is soft deleted', async () => {
      // The bug this prevents: a plain unique constraint keeps the deleted
      // row's value reserved, so recreating a record deleted by mistake fails
      // on a value nobody can see.
      await asTenant(
        schoolA,
        `UPDATE tenant_settings SET deleted_at = now() WHERE setting_key = 'lessonNoteFormat'`,
      );

      await expect(
        asTenant(schoolA, `INSERT INTO tenant_settings (tenant_id, setting_key) VALUES ($1, $2)`, [
          schoolA,
          'lessonNoteFormat',
        ]),
      ).resolves.toBeDefined();
    });

    it('lets two schools use the same key, since uniqueness is per tenant', async () => {
      await expect(
        asTenant(schoolB, `INSERT INTO tenant_settings (tenant_id, setting_key) VALUES ($1, $2)`, [
          schoolB,
          'timezone',
        ]),
      ).resolves.toBeDefined();
    });
  });
});
