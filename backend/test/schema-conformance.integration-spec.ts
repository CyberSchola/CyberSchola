import type { DataSource } from 'typeorm';

import {
  ATTENDANCE_CONTEXTS,
  ATTENDANCE_STATUSES,
  ATTENDANCE_TYPES,
} from '../src/attendance/attendance.enums';
import { ROLES, Role } from '../src/auth/permission.matrix';
import { ROLE_TABLES } from '../src/people/role-tables';
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
      // Single-column keys only. Once tables reference each other through
      // composite keys that include tenant_id (see the next describe block), a
      // looser query would call every referenced table a root. What makes a
      // table a root is that tenant_id on its own points at it.
      const rows = await owner.query<TableRow[]>(`
        SELECT DISTINCT con.confrelid::regclass::text AS table_name
        FROM pg_constraint con
        JOIN pg_attribute a
          ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'f'
          AND con.connamespace = 'public'::regnamespace
          AND array_length(con.conkey, 1) = 1
          AND a.attname = 'tenant_id'
      `);

      rootTables = rows.map((row) => row.table_name);
    });

    it('are discovered rather than hard-coded', () => {
      // Naming tenants here would fix one table. Deriving the set is what makes
      // the next one impossible to miss.
      expect(rootTables).toContain('tenants');
    });

    it('does not mistake a table referenced by a composite key for a root', () => {
      // classes is referenced as (tenant_id, class_id) by enrolments and
      // assignments. That makes it a tenant-owned table in its own right, not a
      // root, and the detection has to tell the two apart.
      expect(rootTables).not.toContain('classes');
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

  describe('references between tenant-owned tables', () => {
    it('always carry the tenant in the foreign key', async () => {
      // Added with the academic spine, which is the first place tenant-owned
      // tables reference each other rather than only tenants itself.
      //
      // A foreign key check in Postgres runs with the table owner's privileges,
      // so it does not respect row-level security. With a plain
      // `class_id REFERENCES classes(id)`, a row acting in one school can point
      // at a class belonging to another school that it cannot even see: WITH
      // CHECK validates the new row's own tenant_id and nothing about its target.
      // Including tenant_id in the key turns that into a foreign key violation.
      // Verified by probe before the spine was written.
      const unsafe = await owner.query<Array<{ reference: string }>>(`
        SELECT con.conrelid::regclass::text || ' -> ' || con.confrelid::regclass::text AS reference
        FROM pg_constraint con
        WHERE con.contype = 'f'
          AND con.connamespace = 'public'::regnamespace
          AND con.confrelid <> 'tenants'::regclass
          -- both sides are tenant-owned
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = con.conrelid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = con.confrelid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
          -- and the key does not include tenant_id
          AND NOT EXISTS (
            SELECT 1 FROM unnest(con.conkey) k
            JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k
            WHERE a.attname = 'tenant_id'
          )
      `);

      expect(unsafe.map((row) => row.reference)).toEqual([]);
    });

    it('finds references to check, so the assertion above is not vacuous', async () => {
      const [row] = await owner.query<Array<{ count: string }>>(`
        SELECT count(*)::text AS count
        FROM pg_constraint con
        WHERE con.contype = 'f'
          AND con.connamespace = 'public'::regnamespace
          AND con.confrelid <> 'tenants'::regclass
      `);

      expect(Number(row?.count)).toBeGreaterThan(0);
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

  describe('views', () => {
    /**
     * Added with BE-P01, the first view in the schema.
     *
     * A Postgres view runs with its owner's privileges unless it says otherwise.
     * The owner is the migration role, which bypasses row-level security, so an
     * ordinary view over tenant-owned tables returns every school's rows to the
     * application while every policy on those tables stays intact and green.
     * `security_invoker = true` makes the view run as the caller.
     */
    it('all run as the caller, so row-level security applies through them', async () => {
      const unsafe = await owner.query<Array<{ view: string }>>(`
        SELECT c.relname AS view
          FROM pg_class c
         WHERE c.relnamespace = 'public'::regnamespace
           AND c.relkind = 'v'
           AND NOT coalesce('security_invoker=true' = ANY (c.reloptions), false)
      `);

      expect(unsafe.map((row) => row.view)).toEqual([]);
    });

    it('exist, so the assertion above is not vacuous', async () => {
      const [row] = await owner.query<Array<{ count: string }>>(`
        SELECT count(*)::text AS count FROM pg_class
         WHERE relnamespace = 'public'::regnamespace AND relkind = 'v'
      `);

      expect(Number(row?.count)).toBeGreaterThan(0);
    });
  });

  describe('roles, the role tables and the membership_roles view', () => {
    /**
     * Three places name the roles and must agree: the Role enum and ROLE_TABLES in
     * code, the Postgres enum, and the branches of membership_roles. A role added
     * without its view branch would be silently stripped from everyone holding it,
     * so the view is read from the catalog and compared, rather than trusted.
     */
    it('reads each role from exactly the table ROLE_TABLES names for it', async () => {
      const rows = await owner.query<Array<{ table_name: string; role: string }>>(`
        SELECT DISTINCT d.refobjid::regclass::text AS table_name, NULL::text AS role
          FROM pg_depend d
          JOIN pg_rewrite w ON w.oid = d.objid
         WHERE w.ev_class = 'membership_roles'::regclass
           AND d.refobjid <> 'membership_roles'::regclass
           AND d.classid = 'pg_rewrite'::regclass
           AND d.refclassid = 'pg_class'::regclass
      `);

      // Every role table, plus memberships: since migration 1757700400000 each branch
      // reads through the membership and requires it to be live, so a removed
      // membership holds no effective role even if a role row survived it.
      const read = rows.map((row) => row.table_name);

      expect(read.filter((table) => table !== 'memberships').sort()).toEqual(
        Object.values(ROLE_TABLES).sort(),
      );
      expect(read).toContain('memberships');

      // And each branch's literal matches its table. Probing each table with a
      // row proves the pairing without parsing SQL: insert into one table, read
      // back which role the view reports.
      const [tenant] = await owner.query<Array<{ id: string }>>(
        `INSERT INTO tenants (name, slug) VALUES ('Parity', 'parity-probe') RETURNING id`,
      );

      try {
        for (const role of ROLES) {
          const [membership] = await owner.query<Array<{ id: string }>>(
            `INSERT INTO memberships (tenant_id, user_id) VALUES ($1, gen_random_uuid()) RETURNING id`,
            [tenant.id],
          );
          const table = ROLE_TABLES[role];
          await owner.query(
            role === Role.SchoolAdmin
              ? `INSERT INTO ${table} (tenant_id, membership_id) VALUES ($1, $2)`
              : `INSERT INTO ${table} (tenant_id, membership_id, first_name, last_name) VALUES ($1, $2, 'P', 'P')`,
            [tenant.id, membership.id],
          );

          const reported = await owner.query<Array<{ role: string }>>(
            `SELECT role::text AS role FROM membership_roles WHERE membership_id = $1`,
            [membership.id],
          );

          expect(reported.map((row) => row.role)).toEqual([role]);
        }
      } finally {
        for (const table of Object.values(ROLE_TABLES)) {
          await owner.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenant.id]);
        }
        await owner.query(`DELETE FROM memberships WHERE tenant_id = $1`, [tenant.id]);
        await owner.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
      }
    });

    it('holds exactly the Role enum values in the database enum', async () => {
      const rows = await owner.query<Array<{ value: string }>>(`
        SELECT unnest(enum_range(NULL::memberships_role_enum))::text AS value
      `);

      expect(rows.map((row) => row.value).sort()).toEqual([...ROLES].sort());
    });

    it('refuses to grant a role to a membership that is not live and active, on every role table', async () => {
      // The trigger is the database half of the membership lifecycle. A role table
      // added later without it could hand a role to a suspended or removed member.
      const rows = await owner.query<Array<{ table_name: string }>>(`
        SELECT c.relname AS table_name
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_proc p ON p.oid = t.tgfoid
         WHERE p.proname = 'role_requires_active_membership' AND NOT t.tgisinternal
      `);

      expect(rows.map((row) => row.table_name).sort()).toEqual(Object.values(ROLE_TABLES).sort());
    });

    it("ends a membership's roles when the membership is removed", async () => {
      const rows = await owner.query<Array<{ tgname: string }>>(`
        SELECT tgname FROM pg_trigger
         WHERE tgrelid = 'memberships'::regclass AND NOT tgisinternal
      `);

      expect(rows.map((row) => row.tgname)).toContain('memberships_end_roles_on_removal');
    });

    it('gives every role table the tenant isolation every tenant-owned table has', () => {
      for (const table of Object.values(ROLE_TABLES)) {
        expect(tenantOwnedTables).toContain(table);
      }
    });
  });
  describe('attendance', () => {
    /**
     * Blueprint sections 91 and 96, as gates rather than as tests of today's
     * behaviour. The behaviour has its own suite; these exist so that a future
     * migration recreating the table, or adding a status on one side only,
     * fails the build instead of quietly removing a guarantee.
     */
    it('holds exactly the AttendanceStatus enum values in the database enum', async () => {
      const rows = await owner.query<Array<{ value: string }>>(`
        SELECT unnest(enum_range(NULL::attendance_status_enum))::text AS value
      `);

      expect(rows.map((row) => row.value).sort()).toEqual([...ATTENDANCE_STATUSES].sort());
    });

    it('holds exactly the AttendanceType enum values in the database enum', async () => {
      const rows = await owner.query<Array<{ value: string }>>(`
        SELECT unnest(enum_range(NULL::attendance_type_enum))::text AS value
      `);

      expect(rows.map((row) => row.value).sort()).toEqual([...ATTENDANCE_TYPES].sort());
    });

    it('keeps every context the application knows about in the database type', async () => {
      const rows = await owner.query<Array<{ value: string }>>(`
        SELECT unnest(enum_range(NULL::attendance_context_enum))::text AS value
      `);

      expect(rows.map((row) => row.value).sort()).toEqual([...ATTENDANCE_CONTEXTS].sort());
    });

    it('still has the trigger that writes the correction trail', async () => {
      const rows = await owner.query<Array<{ tgname: string }>>(`
        SELECT tgname FROM pg_trigger
         WHERE tgrelid = 'attendance'::regclass AND NOT tgisinternal
      `);

      expect(rows.map((row) => row.tgname)).toContain('record_attendance_correction_trigger');
    });

    it('still has the trigger that keeps a record inside its term', async () => {
      const rows = await owner.query<Array<{ tgname: string }>>(`
        SELECT tgname FROM pg_trigger
         WHERE tgrelid = 'attendance'::regclass AND NOT tgisinternal
      `);

      expect(rows.map((row) => row.tgname)).toContain('attendance_within_term_trigger');
    });

    it('keeps the correction trail append only for the application role', async () => {
      const [row] = await owner.query<
        Array<{ insert: boolean; select: boolean; update: boolean; delete: boolean }>
      >(`
        SELECT has_table_privilege('cyberschola_app', 'attendance_corrections', 'INSERT') AS insert,
               has_table_privilege('cyberschola_app', 'attendance_corrections', 'SELECT') AS select,
               has_table_privilege('cyberschola_app', 'attendance_corrections', 'UPDATE') AS update,
               has_table_privilege('cyberschola_app', 'attendance_corrections', 'DELETE') AS delete
      `);

      expect(row).toEqual({ insert: true, select: true, update: false, delete: false });
    });

    it('keeps one record per person per school day, per kind of person', async () => {
      const rows = await owner.query<Array<{ indexname: string }>>(`
        SELECT indexname FROM pg_indexes
         WHERE tablename = 'attendance' AND indexdef LIKE '%UNIQUE%'
      `);

      expect(rows.map((row) => row.indexname).sort()).toEqual([
        'attendance_one_per_staff_school_day',
        'attendance_one_per_student_school_day',
        'attendance_one_per_teacher_school_day',
        'attendance_pkey',
        'attendance_tenant_id_unique',
      ]);
    });
  });
});
