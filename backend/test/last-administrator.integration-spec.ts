import { DataSource, type QueryRunner } from 'typeorm';

import { Role } from '../src/auth/permission.matrix';
import { ResourceConflictException } from '../src/common/exceptions/app.exception';
import { PeopleService } from '../src/people/people.service';
import { runWithRequestContext } from '../src/tenancy/request-context';
import { TenantTransactionService } from '../src/tenancy/tenant-transaction.service';
import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';
import { seedMember } from './people.fixtures';

/**
 * A school can never be left without an administrator, even when two remove each
 * other at the same moment.
 *
 * The race, made deterministic. Firing two HTTP requests at once does not reliably
 * overlap the critical section, and a race test that only sometimes races proves
 * nothing: an earlier version passed with the lock removed. So this suite holds
 * one removal open in a transaction of its own, runs the real service's removal
 * against it, and requires that the service waits for the lock, then counts one
 * administrator, and refuses. Without the lock the service would count two, remove
 * its target, and both removals would commit.
 */
describe('removing the last administrator', () => {
  let owner: DataSource;
  let app: DataSource;
  let people: PeopleService;

  const APP_PASSWORD = 'app_role_local_only';
  const SCHOOL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const FIRST = '50000000-0000-4000-8000-000000000001';
  const SECOND = '50000000-0000-4000-8000-000000000002';

  let firstAdmin: string;
  let secondAdmin: string;

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
      extra: { max: 4 },
    });
    await app.initialize();
    people = new PeopleService(new TenantTransactionService(app));

    await owner.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'Cedar', 'cedar')`, [
      SCHOOL,
    ]);
  }, 120_000);

  beforeEach(async () => {
    await owner.query(`DELETE FROM school_admins WHERE tenant_id = $1`, [SCHOOL]);
    await owner.query(`DELETE FROM memberships WHERE tenant_id = $1`, [SCHOOL]);
    firstAdmin = (await seedMember(owner, SCHOOL, FIRST, [Role.SchoolAdmin])).roleRows[
      Role.SchoolAdmin
    ]!;
    secondAdmin = (await seedMember(owner, SCHOOL, SECOND, [Role.SchoolAdmin])).roleRows[
      Role.SchoolAdmin
    ]!;
  });

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  /** Removes an administrator through the real service, acting as a given admin. */
  const removeAs = (userId: string, adminId: string) =>
    runWithRequestContext(
      {
        origin: 'http',
        tenantId: SCHOOL,
        userId,
        roles: [Role.SchoolAdmin],
        requestId: 'last-admin',
      },
      () => people.removeAdmin(adminId),
    );

  const liveAdmins = async () => {
    const [row] = await owner.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM school_admins WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [SCHOOL],
    );
    return Number(row?.count);
  };

  it('refuses to remove the only administrator', async () => {
    await removeAs(FIRST, secondAdmin);

    await expect(removeAs(FIRST, firstAdmin)).rejects.toBeInstanceOf(ResourceConflictException);
    expect(await liveAdmins()).toBe(1);
  });

  it('makes a concurrent removal wait, then refuses it, so one administrator always remains', async () => {
    // The first administrator's removal of the second, open and uncommitted,
    // holding the same row locks the service takes.
    const held: QueryRunner = app.createQueryRunner();
    await held.connect();
    await held.startTransaction();
    await held.query(`SELECT set_config('app.current_user', $1, true)`, [FIRST]);
    await held.query(`SELECT set_config('app.current_tenant', $1, true)`, [SCHOOL]);
    await held.query(
      `SELECT id FROM school_admins WHERE tenant_id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [SCHOOL],
    );
    await held.query(`UPDATE school_admins SET deleted_at = now() WHERE id = $1`, [secondAdmin]);

    try {
      // Meanwhile the second administrator removes the first.
      let settled = false;
      const concurrent = removeAs(SECOND, firstAdmin).then(
        () => ({ settled: (settled = true), outcome: 'removed' as const }),
        (error: unknown) => ({ settled: (settled = true), outcome: error }),
      );

      // With the lock, the service is blocked on the held rows. Without it, it
      // would already have counted two administrators and removed its target.
      await new Promise((resolve) => setTimeout(resolve, 750));
      expect(settled).toBe(false);

      await held.commitTransaction();

      const result = await concurrent;
      expect(result.outcome).toBeInstanceOf(ResourceConflictException);
      expect(await liveAdmins()).toBe(1);
    } finally {
      if (held.isTransactionActive) await held.rollbackTransaction();
      await held.release();
    }
  });
});
