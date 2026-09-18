import { DataSource, type EntityManager } from 'typeorm';

import { Role } from '../src/auth/permission.matrix';
import { rolesOfMembership } from '../src/tenancy/membership-roles';
import { APP_ROLE_PASSWORD } from './app-database.env';
import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';
import { seedMember, seedRoleRow } from './people.fixtures';

/**
 * The membership lifecycle and the roles that hang off it, proved at the
 * database.
 *
 * Migration 1757700400000 states the rule: a role is only granted to a live,
 * active membership; suspension keeps roles inert and reversible; removal ends
 * them in the same statement; and a removed membership has no effective role
 * even if a row survived it. Every case here sends SQL straight to Postgres as
 * `cyberschola_app`, with no application code in the path, because the point of
 * putting the rule in the database is that a job, a migration or a hand-written
 * statement meets it too.
 */
describe('membership lifecycle', () => {
  let owner: DataSource;
  let app: DataSource;

  const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let counter = 0;

  /** A fresh user id per case, so no case depends on another's state. */
  const nextUser = () => `80000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

  /** Runs work as the application role, inside the school. */
  async function asApp<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return app.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_user', $1, true)`, [nextUser()]);
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [SCHOOL]);

      return work(manager);
    });
  }

  /** The roles the view reports for a membership, read as the application would. */
  async function effectiveRoles(membershipId: string): Promise<string[]> {
    return asApp(async (manager) => [...(await rolesOfMembership(manager, SCHOOL, membershipId))]);
  }

  async function setMembership(membershipId: string, change: 'suspend' | 'reactivate' | 'remove') {
    const sql = {
      suspend: `UPDATE memberships SET status = 'SUSPENDED' WHERE id = $1`,
      reactivate: `UPDATE memberships SET status = 'ACTIVE' WHERE id = $1`,
      remove: `UPDATE memberships SET deleted_at = now() WHERE id = $1`,
    }[change];

    await asApp((manager) => manager.query(sql, [membershipId]));
  }

  beforeAll(async () => {
    owner = createTestDataSource();
    await owner.initialize();
    await resetSchema(owner);
    await owner.runMigrations({ transaction: 'all' });
    await owner.query(`ALTER ROLE cyberschola_app WITH PASSWORD '${APP_ROLE_PASSWORD}'`);

    const url = new URL(integrationDatabaseUrl());
    url.username = 'cyberschola_app';
    url.password = APP_ROLE_PASSWORD;
    app = new DataSource({
      type: 'postgres',
      url: url.toString(),
      ssl: false,
      synchronize: false,
      logging: ['error'],
      entities: ['src/**/*.entity.ts'],
    });
    await app.initialize();

    await owner.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Greenfield', 'greenfield')`,
      [SCHOOL],
    );

    // A standing administrator, so removing other administrators in these cases
    // never trips the last-administrator rule unless a case means it to.
    await seedMember(owner, SCHOOL, nextUser(), [Role.SchoolAdmin]);
  }, 120_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  // -------------------------------------------------------------------------
  // Granting
  // -------------------------------------------------------------------------

  describe('granting a role', () => {
    it('refuses to make a suspended membership an administrator', async () => {
      const { membershipId } = await seedMember(owner, SCHOOL, nextUser(), [], {
        status: 'SUSPENDED',
      });

      await expect(
        asApp((manager) =>
          manager.query(`INSERT INTO school_admins (tenant_id, membership_id) VALUES ($1, $2)`, [
            SCHOOL,
            membershipId,
          ]),
        ),
      ).rejects.toThrow(/only be given to an active membership/);
    });

    it('refuses to link a suspended membership to a person record', async () => {
      const { membershipId } = await seedMember(owner, SCHOOL, nextUser(), [], {
        status: 'SUSPENDED',
      });
      const teacher = await seedRoleRow(owner, SCHOOL, Role.Teacher, null);

      await expect(
        asApp((manager) =>
          manager.query(`UPDATE teachers SET membership_id = $1 WHERE id = $2`, [
            membershipId,
            teacher,
          ]),
        ),
      ).rejects.toThrow(/only be given to an active membership/);
    });

    it('refuses to grant a role to a removed membership', async () => {
      const { membershipId } = await seedMember(owner, SCHOOL, nextUser(), [], { deleted: true });

      await expect(
        asApp((manager) =>
          manager.query(`INSERT INTO school_admins (tenant_id, membership_id) VALUES ($1, $2)`, [
            SCHOOL,
            membershipId,
          ]),
        ),
      ).rejects.toThrow(/has been removed/);
    });

    it('grants to an active membership, so the refusals are about lifecycle alone', async () => {
      const { membershipId } = await seedMember(owner, SCHOOL, nextUser(), []);
      const staff = await seedRoleRow(owner, SCHOOL, Role.Staff, null);

      await asApp((manager) =>
        manager.query(`UPDATE staff SET membership_id = $1 WHERE id = $2`, [membershipId, staff]),
      );

      expect(await effectiveRoles(membershipId)).toEqual([Role.Staff]);
    });

    it("still lets a suspended member's record be edited, because only the link is guarded", async () => {
      const { roleRows } = await seedMember(owner, SCHOOL, nextUser(), [Role.Teacher], {
        status: 'SUSPENDED',
      });

      await asApp((manager) =>
        manager.query(`UPDATE teachers SET last_name = 'Renamed' WHERE id = $1`, [
          roleRows[Role.Teacher],
        ]),
      );

      const [row] = await owner.query<Array<{ last_name: string }>>(
        `SELECT last_name FROM teachers WHERE id = $1`,
        [roleRows[Role.Teacher]],
      );

      expect(row.last_name).toBe('Renamed');
    });
  });

  // -------------------------------------------------------------------------
  // Suspending
  // -------------------------------------------------------------------------

  describe('suspending a membership', () => {
    it('keeps its roles, and reactivating brings them back unchanged', async () => {
      const { membershipId } = await seedMember(owner, SCHOOL, nextUser(), [
        Role.Teacher,
        Role.Parent,
      ]);

      await setMembership(membershipId, 'suspend');

      const [stored] = await owner.query<Array<{ count: string }>>(
        `SELECT count(*) AS count FROM teachers WHERE membership_id = $1 AND deleted_at IS NULL`,
        [membershipId],
      );

      // Suspension is reversible: the school switched the person off, it did not
      // rewrite what they are. The roles are inert because every path that uses
      // a role refuses a membership that is not ACTIVE.
      expect(Number(stored.count)).toBe(1);

      await setMembership(membershipId, 'reactivate');

      expect((await effectiveRoles(membershipId)).sort()).toEqual([Role.Parent, Role.Teacher]);
    });
  });

  // -------------------------------------------------------------------------
  // Removing
  // -------------------------------------------------------------------------

  describe('removing a membership', () => {
    it('ends every role it holds in the same statement, and keeps the person records', async () => {
      const { membershipId, roleRows } = await seedMember(owner, SCHOOL, nextUser(), [
        Role.SchoolAdmin,
        Role.Teacher,
        Role.Parent,
      ]);

      await setMembership(membershipId, 'remove');

      const [admin] = await owner.query<Array<{ deleted: boolean }>>(
        `SELECT deleted_at IS NOT NULL AS deleted FROM school_admins WHERE id = $1`,
        [roleRows[Role.SchoolAdmin]],
      );
      const people = await owner.query<Array<{ membership_id: string | null; deleted: boolean }>>(
        `SELECT membership_id, deleted_at IS NOT NULL AS deleted FROM teachers WHERE id = $1
         UNION ALL
         SELECT membership_id, deleted_at IS NOT NULL FROM parents WHERE id = $2`,
        [roleRows[Role.Teacher], roleRows[Role.Parent]],
      );

      // The administrator role is ended. The teacher and parent records are the
      // people themselves, so they survive, unlinked from the removed login.
      expect(admin.deleted).toBe(true);
      expect(people).toEqual([
        { membership_id: null, deleted: false },
        { membership_id: null, deleted: false },
      ]);
      expect(await effectiveRoles(membershipId)).toEqual([]);
    });

    it('leaves a role row that was already removed alone, still saying whose it was', async () => {
      // A deleted role row is history, not a role. Unlinking it would erase the
      // record of which login it belonged to, which the backfill in migration
      // 1757700100000 keeps on purpose.
      const { membershipId, roleRows } = await seedMember(owner, SCHOOL, nextUser(), [
        Role.Teacher,
      ]);

      await asApp((manager) =>
        manager.query(`UPDATE teachers SET deleted_at = now() WHERE id = $1`, [
          roleRows[Role.Teacher],
        ]),
      );
      await setMembership(membershipId, 'remove');

      const [row] = await owner.query<Array<{ membership_id: string | null }>>(
        `SELECT membership_id FROM teachers WHERE id = $1`,
        [roleRows[Role.Teacher]],
      );

      expect(row.membership_id).toBe(membershipId);
    });

    it('holds no effective role even if a role row somehow survived it', async () => {
      // The view is the second half of the guarantee, and this proves it stands
      // on its own: the trigger is switched off for one statement, as a bulk
      // import or a careless fix might, and a live role row is pointed at a
      // membership that has already been removed.
      const { membershipId } = await seedMember(owner, SCHOOL, nextUser(), [], { deleted: true });

      await owner.transaction(async (manager) => {
        await manager.query(`SET LOCAL session_replication_role = replica`);
        await manager.query(
          `INSERT INTO school_admins (tenant_id, membership_id) VALUES ($1, $2)`,
          [SCHOOL, membershipId],
        );
      });

      const [row] = await owner.query<Array<{ count: string }>>(
        `SELECT count(*) AS count FROM school_admins WHERE membership_id = $1 AND deleted_at IS NULL`,
        [membershipId],
      );

      expect(Number(row.count)).toBe(1);
      expect(await effectiveRoles(membershipId)).toEqual([]);
    });

    it("refuses to remove the membership holding the school's last administrator role", async () => {
      const school = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      await owner.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, 'Lone', 'lone')`, [
        school,
      ]);
      const { membershipId } = await seedMember(owner, school, nextUser(), [Role.SchoolAdmin]);

      await expect(
        app.transaction(async (manager) => {
          await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [school]);
          await manager.query(`UPDATE memberships SET deleted_at = now() WHERE id = $1`, [
            membershipId,
          ]);
        }),
      ).rejects.toThrow(/last administrator/);

      const [row] = await owner.query<Array<{ deleted: boolean }>>(
        `SELECT deleted_at IS NOT NULL AS deleted FROM memberships WHERE id = $1`,
        [membershipId],
      );

      // Refused, not half done: the membership is still live and still an admin.
      expect(row.deleted).toBe(false);
    });

    it('lets a person who comes back start with no roles, and be linked to their record again', async () => {
      const person = nextUser();
      const first = await seedMember(owner, SCHOOL, person, [Role.Student]);
      const record = first.roleRows[Role.Student]!;

      await setMembership(first.membershipId, 'remove');

      const second = await seedMember(owner, SCHOOL, person, []);

      // Nothing carries over from the old membership by accident.
      expect(await effectiveRoles(second.membershipId)).toEqual([]);

      await asApp((manager) =>
        manager.query(`UPDATE students SET membership_id = $1 WHERE id = $2`, [
          second.membershipId,
          record,
        ]),
      );

      expect(await effectiveRoles(second.membershipId)).toEqual([Role.Student]);
    });
  });
});
