import type { DataSource } from 'typeorm';

import { createTestDataSource, resetSchema } from './database.setup';

/**
 * Migrations, against a real Postgres.
 *
 * None of this is testable with a mocked repository. A mock reports whatever
 * it was told to, so a suite built on one stays green whether or not the
 * migration runs, whether or not the extension exists, and whether or not a
 * second run would fail. Those are exactly the failures that only appear
 * during a deploy.
 */
describe('database migrations', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource();
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await resetSchema(dataSource);
  });

  it('applies cleanly to an empty database', async () => {
    const applied = await dataSource.runMigrations({ transaction: 'all' });

    expect(applied.length).toBeGreaterThan(0);
    expect(applied.map((migration) => migration.name)).toContain(
      'EnableRequiredExtensions1757290000000',
    );
  });

  it('is safe to run twice, which is what a redeploy does', async () => {
    await dataSource.runMigrations({ transaction: 'all' });

    // A second run must be a no-op, not an error. A redeploy, a restarted
    // pipeline or a rolled-back release all re-run this command.
    const secondRun = await dataSource.runMigrations({ transaction: 'all' });

    expect(secondRun).toHaveLength(0);
  });

  it('reports nothing pending once applied', async () => {
    await dataSource.runMigrations({ transaction: 'all' });

    await expect(dataSource.showMigrations()).resolves.toBe(false);
  });

  it('records what it applied, so a partial deploy is diagnosable', async () => {
    await dataSource.runMigrations({ transaction: 'all' });

    const rows = await dataSource.query<Array<{ name: string }>>(
      'SELECT name FROM migrations ORDER BY timestamp',
    );

    expect(rows.map((row) => row.name)).toContain('EnableRequiredExtensions1757290000000');
  });

  describe('required extensions', () => {
    beforeEach(async () => {
      await dataSource.runMigrations({ transaction: 'all' });
    });

    it.each(['pgcrypto', 'citext'])('enables %s', async (extension) => {
      const rows = await dataSource.query<Array<{ extname: string }>>(
        'SELECT extname FROM pg_extension WHERE extname = $1',
        [extension],
      );

      expect(rows).toHaveLength(1);
    });

    it('gives us gen_random_uuid(), which primary keys depend on', async () => {
      const [row] = await dataSource.query<Array<{ id: string }>>(
        'SELECT gen_random_uuid()::text AS id',
      );

      // Random rather than sequential, so an id leaks neither row count nor
      // creation order across tenants.
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('gives us case-insensitive comparison through citext', async () => {
      const [row] = await dataSource.query<Array<{ same: boolean }>>(
        `SELECT ('Head@School.NG'::citext = 'head@school.ng'::citext) AS same`,
      );

      expect(row.same).toBe(true);
    });

    it('still compares case-sensitively for plain text, so citext is doing the work', async () => {
      const [row] = await dataSource.query<Array<{ same: boolean }>>(
        `SELECT ('Head@School.NG' = 'head@school.ng') AS same`,
      );

      expect(row.same).toBe(false);
    });
  });

  describe('reverting', () => {
    it('leaves the extensions in place, because they are not ours to remove', async () => {
      await dataSource.runMigrations({ transaction: 'all' });
      await dataSource.undoLastMigration({ transaction: 'all' });

      // Dropping an extension would break anything else in the project using
      // its types. On Supabase these may have been enabled by the platform
      // rather than by us, so reverting must not reach outside our own schema.
      const rows = await dataSource.query<Array<{ extname: string }>>(
        "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'citext')",
      );

      expect(rows).toHaveLength(2);
    });

    it('can be reapplied after a revert', async () => {
      await dataSource.runMigrations({ transaction: 'all' });
      await dataSource.undoLastMigration({ transaction: 'all' });

      const reapplied = await dataSource.runMigrations({ transaction: 'all' });

      expect(reapplied.length).toBeGreaterThan(0);
    });
  });

  it('never has synchronize enabled, which would bypass migrations entirely', () => {
    // Worth asserting rather than trusting. `synchronize: true` silently
    // reshapes a live schema to match the entities, and against production
    // that is how a column and the data in it disappear.
    expect(dataSource.options.synchronize).toBe(false);
  });
});
