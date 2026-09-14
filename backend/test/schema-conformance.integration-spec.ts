import type { DataSource } from 'typeorm';

import { createTestDataSource, resetSchema } from './database.setup';

interface TableRow {
  table_name: string;
}

interface SecurityRow {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  policy_count: string;
}

/**
 * The schema half of the conformance idea.
 *
 * BE-T02 added a gate so a new HTTP route cannot quietly skip tenant scoping.
 * This is the same argument one layer down: a new tenant-owned *table* must not
 * be able to reach `develop` without row-level security on it.
 *
 * The review of BE-T01 asked exactly this. Blanket default privileges meant a
 * future `CREATE TABLE students (... tenant_id ...)` handed the application
 * role full DML with no policy attached, so isolation depended on someone
 * remembering to call `apply_tenant_isolation`. Two things now prevent that:
 * the grant moved inside that function, and this suite fails the build if any
 * table with a `tenant_id` column is missing its protection.
 *
 * Read from the live catalog rather than from a list in this file, for the same
 * reason the route inventory is discovered rather than hand-kept: a list is the
 * thing that goes stale, and a stale list passes.
 *
 * Connects as the owner, because reading pg_class and pg_policies is a catalog
 * question rather than a tenant one. What is being verified here is the shape
 * of the schema, not what a given role can see through it; the isolation suite
 * covers that as `cyberschola_app`.
 */
describe('schema conformance', () => {
  let owner: DataSource;

  /** Every table in `public` carrying a tenant_id column. */
  let tenantOwnedTables: string[];

  beforeAll(async () => {
    owner = createTestDataSource();
    await owner.initialize();
    await resetSchema(owner);
    await owner.runMigrations({ transaction: 'all' });

    const rows = await owner.query<TableRow[]>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN information_schema.columns col
        ON col.table_schema = n.nspname
       AND col.table_name = c.relname
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND col.column_name = 'tenant_id'
      ORDER BY c.relname
    `);

    tenantOwnedTables = rows.map((row) => row.table_name);
  }, 120_000);

  afterAll(async () => {
    await owner?.destroy();
  });

  describe('the inventory', () => {
    it('finds at least one tenant-owned table, so the checks below are not vacuous', () => {
      // Without this the loops pass by iterating nothing, which is the failure
      // the BE-T02 conformance suite already had to be corrected for once.
      expect(tenantOwnedTables.length).toBeGreaterThan(0);
    });

    it('is discovered from the catalog rather than hard-coded', () => {
      // tenant_settings is the table that exists today. The assertion is that
      // discovery found it, not that the list equals it: a table added
      // tomorrow must appear here without anyone editing this file.
      expect(tenantOwnedTables).toContain('tenant_settings');
    });
  });

  describe('every tenant-owned table', () => {
    let security: SecurityRow[];

    beforeAll(async () => {
      security = await owner.query<SecurityRow[]>(
        `
        SELECT
          c.relname AS table_name,
          c.relrowsecurity AS rls_enabled,
          c.relforcerowsecurity AS rls_forced,
          (SELECT count(*) FROM pg_policies p
            WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname = ANY($1)
      `,
        [tenantOwnedTables],
      );
    });

    it('has row-level security enabled', () => {
      const missing = security.filter((row) => !row.rls_enabled).map((row) => row.table_name);

      // If this fails, a migration created a table with a tenant_id column and
      // never called apply_tenant_isolation on it. Without RLS the policies
      // are absent entirely and every school can read the whole table.
      expect(missing).toEqual([]);
    });

    it('has row-level security forced, so the owner is bound too', () => {
      const missing = security.filter((row) => !row.rls_forced).map((row) => row.table_name);

      // ENABLE alone leaves the table owner unfiltered. A deployment that
      // connects as the owner would then have no isolation while every test
      // that connects as the app role still passes.
      expect(missing).toEqual([]);
    });

    it('carries at least one policy', () => {
      const missing = security
        .filter((row) => Number(row.policy_count) === 0)
        .map((row) => row.table_name);

      // RLS enabled with no policy denies everything, which fails safe but
      // would take the feature down rather than isolate it. Either way it is
      // not a table anyone meant to ship.
      expect(missing).toEqual([]);
    });
  });

  describe('tenant-root tables', () => {
    /**
     * Tables that other tenant-owned tables point at through `tenant_id`.
     *
     * Added after review of BE-A01. The check above finds tables by looking for
     * a `tenant_id` column, and `tenants` has none: it *is* the tenant, and its
     * own `id` plays that role. That blind spot is exactly why the table sat
     * with full DML granted to the application and no policy on it until
     * authentication made it reachable.
     *
     * Rather than name `tenants` here, which would only patch the instance,
     * this derives the set from the catalog: anything a `tenant_id` foreign key
     * points at is a tenant root and needs the same protection. A future root
     * table is caught without anyone remembering to add it.
     */
    let rootTables: string[];

    beforeAll(async () => {
      const rows = await owner.query<TableRow[]>(`
        SELECT DISTINCT ccu.table_name AS table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
         AND kcu.table_schema = tc.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND kcu.column_name = 'tenant_id'
      `);

      rootTables = rows.map((row) => row.table_name);
    });

    it('are discovered rather than hard-coded', () => {
      // Naming tenants here would fix one table. Deriving the set is what makes
      // the next one impossible to miss.
      expect(rootTables).toContain('tenants');
    });

    it('all have row-level security enabled and forced', async () => {
      const unprotected = await owner.query<TableRow[]>(
        `
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1)
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
      `,
        [rootTables],
      );

      expect(unprotected.map((row) => row.table_name)).toEqual([]);
    });

    it('all carry at least one policy', async () => {
      const withoutPolicy = await owner.query<TableRow[]>(
        `
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1)
          AND NOT EXISTS (
            SELECT 1 FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = c.relname
          )
      `,
        [rootTables],
      );

      expect(withoutPolicy.map((row) => row.table_name)).toEqual([]);
    });
  });

  describe('the application role cannot reach an unprotected tenant table', () => {
    it('holds no DML on a tenant-owned table that lacks row-level security', async () => {
      const exposed = await owner.query<TableRow[]>(`
        SELECT DISTINCT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN information_schema.columns col
          ON col.table_schema = n.nspname AND col.table_name = c.relname
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND col.column_name = 'tenant_id'
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
          AND (
            has_table_privilege('cyberschola_app', c.oid, 'SELECT')
            OR has_table_privilege('cyberschola_app', c.oid, 'INSERT')
            OR has_table_privilege('cyberschola_app', c.oid, 'UPDATE')
            OR has_table_privilege('cyberschola_app', c.oid, 'DELETE')
          )
      `);

      // The precise condition the review was worried about: access granted to
      // a tenant table that has no policy protecting it.
      expect(exposed.map((row) => row.table_name)).toEqual([]);
    });

    it('is not granted new tables automatically any more', async () => {
      const defaults = await owner.query<Array<{ acl: string | null }>>(`
        SELECT array_to_string(d.defaclacl, ',') AS acl
        FROM pg_default_acl d
        JOIN pg_namespace n ON n.oid = d.defaclnamespace
        WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
      `);

      // Blanket default privileges are what made a forgotten
      // apply_tenant_isolation call dangerous rather than merely broken. With
      // them gone, a new table grants the application nothing until the
      // isolation function grants it.
      const grantsToApp = defaults.filter((row) => row.acl?.includes('cyberschola_app'));

      expect(grantsToApp).toEqual([]);
    });
  });

  describe('apply_tenant_isolation', () => {
    it('grants the application role as part of applying the policy', async () => {
      // The two are welded together on purpose. If a future edit separates
      // them, the table below ends up unreadable and this fails.
      await owner.query(`
        CREATE TABLE conformance_probe (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
        )
      `);

      try {
        const beforeIsolation = await owner.query<Array<{ granted: boolean }>>(
          `SELECT has_table_privilege('cyberschola_app', 'conformance_probe', 'SELECT') AS granted`,
        );

        // A brand new table starts with no application access at all.
        expect(beforeIsolation[0]?.granted).toBe(false);

        await owner.query(`SELECT apply_tenant_isolation('conformance_probe')`);

        const afterIsolation = await owner.query<Array<{ granted: boolean }>>(
          `SELECT has_table_privilege('cyberschola_app', 'conformance_probe', 'SELECT') AS granted`,
        );

        expect(afterIsolation[0]?.granted).toBe(true);
      } finally {
        await owner.query('DROP TABLE IF EXISTS conformance_probe');
      }
    });

    it('refuses a table with no tenant_id column', async () => {
      // Calling it on a global table would create a policy that can never
      // match, leaving a table that looks protected and is simply broken.
      await owner.query(`CREATE TABLE global_probe (id uuid PRIMARY KEY)`);

      try {
        await expect(owner.query(`SELECT apply_tenant_isolation('global_probe')`)).rejects.toThrow(
          /tenant_id/i,
        );
      } finally {
        await owner.query('DROP TABLE IF EXISTS global_probe');
      }
    });
  });
});
