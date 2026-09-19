import { DataSource } from 'typeorm';

import { Permission, ROLES, Role, roleHasPermission } from '../src/auth/permission.matrix';
import { runWithRequestContext } from '../src/tenancy/request-context';
import { ListMembersAction } from '../src/identity/list-members.action';
import { createTestDataSource, integrationDatabaseUrl, resetSchema } from './database.setup';
import { seedMember } from './people.fixtures';

/**
 * The access scope, proven against real Postgres as the role that serves traffic.
 *
 * Two layers are at work and they answer different questions. Row-level
 * security decides which school's rows exist at all. The access scope decides
 * which of those this particular caller may see. A mistake in the first is a
 * cross-tenant leak; a mistake in the second shows one member of a school data
 * belonging to another member of the same school. Both matter, and only the
 * second is application code.
 *
 * The count assertions are the ones worth reading. Scoping the list while
 * leaving the total unscoped is the classic version of this bug: the rows are
 * hidden and the number still tells you how many exist.
 */
describe('access scope', () => {
  let owner: DataSource;
  let app: DataSource;

  let school: string;
  let otherSchool: string;

  const admin = '11111111-1111-4111-8111-111111111111';
  const teacher = '22222222-2222-4222-8222-222222222222';
  const student = '33333333-3333-4333-8333-333333333333';
  const outsider = '44444444-4444-4444-8444-444444444444';

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

    const rows = await owner.query<Array<{ id: string }>>(`
      INSERT INTO tenants (name, slug) VALUES
        ('Greenfield Academy', 'greenfield'),
        ('Brookvale School', 'brookvale')
      RETURNING id
    `);
    [school, otherSchool] = rows.map((row) => row.id) as [string, string];

    await seedMember(owner, school, admin, [Role.SchoolAdmin]);
    await seedMember(owner, school, teacher, [Role.Teacher]);
    await seedMember(owner, school, student, [Role.Student]);
    await seedMember(owner, otherSchool, outsider, [Role.SchoolAdmin]);
  }, 120_000);

  afterAll(async () => {
    if (app?.isInitialized) await app.destroy();
    if (owner?.isInitialized) await owner.destroy();
  });

  /** Lists members exactly as a request would, with both session variables set. */
  async function listAs(
    userId: string,
    role: Role | readonly Role[],
    tenantId: string = school,
    limit = 50,
    offset = 0,
  ) {
    return runWithRequestContext(
      {
        origin: 'http',
        tenantId,
        userId,
        roles: typeof role === 'string' ? [role] : role,
        requestId: 'test',
      },
      () =>
        app.transaction(async (manager) => {
          await manager.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
          await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

          return new ListMembersAction(manager).execute(limit, offset);
        }),
    );
  }

  describe('a school administrator', () => {
    it('sees every member of their school', async () => {
      const page = await listAs(admin, Role.SchoolAdmin);

      expect(page.items.map((member) => member.userId).sort()).toEqual(
        [admin, teacher, student].sort(),
      );
    });

    it('gets a total matching what they can see', async () => {
      const page = await listAs(admin, Role.SchoolAdmin);

      expect(page.total).toBe(3);
    });

    it('still sees nothing from another school', async () => {
      // The outsider is a SCHOOL_ADMIN too, in a different school. The access
      // scope does not narrow this caller at all, so if the tenant boundary
      // were the only thing standing between them, this is where it would show.
      const page = await listAs(admin, Role.SchoolAdmin);

      expect(page.items.map((member) => member.userId)).not.toContain(outsider);
    });
  });

  describe('every other role', () => {
    it.each([
      ['a teacher', teacher, Role.Teacher],
      ['a student', student, Role.Student],
    ])('%s sees only their own membership', async (_label, userId, role) => {
      const page = await listAs(userId, role);

      expect(page.items.map((member) => member.userId)).toEqual([userId]);
    });

    it.each([
      ['a teacher', teacher, Role.Teacher],
      ['a student', student, Role.Student],
    ])('%s gets a total of one, not three', async (_label, userId, role) => {
      // The assertion this suite exists for. A scoped list with an unscoped
      // count still tells a teacher how many people are in the school, and
      // pagination would let them walk the boundary of what they cannot see.
      const page = await listAs(userId, role);

      expect(page.total).toBe(1);
    });

    it('shows a person holding two non-administrator roles their own row once', async () => {
      // Both roles carry the same "own membership" fragment. It must be applied
      // once, not ORed with itself into a duplicate or a widened predicate.
      const page = await listAs(teacher, [Role.Teacher, Role.Parent]);

      expect(page.items.map((member) => member.userId)).toEqual([teacher]);
      expect(page.total).toBe(1);
    });

    it('shows a member with no roles nothing, including themselves', async () => {
      // No role contributes a fragment, so the scope is FALSE.
      const page = await listAs(teacher, []);

      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('does not let a teacher see the administrator', async () => {
      const page = await listAs(teacher, Role.Teacher);

      expect(page.items.map((member) => member.userId)).not.toContain(admin);
    });
  });

  describe('pagination', () => {
    it('honours the limit', async () => {
      const page = await listAs(admin, Role.SchoolAdmin, school, 2, 0);

      expect(page.items).toHaveLength(2);
    });

    it('reports the full scoped total regardless of the page size', async () => {
      const page = await listAs(admin, Role.SchoolAdmin, school, 2, 0);

      expect(page.total).toBe(3);
    });

    it('walks the whole set without repeating or skipping', async () => {
      const first = await listAs(admin, Role.SchoolAdmin, school, 2, 0);
      const second = await listAs(admin, Role.SchoolAdmin, school, 2, 2);
      const seen = [...first.items, ...second.items].map((member) => member.userId);

      expect(seen.sort()).toEqual([admin, teacher, student].sort());
      expect(new Set(seen).size).toBe(3);
    });

    it('does not let an offset walk past the scope', async () => {
      // A teacher paging beyond their single row must find nothing rather than
      // the next person's.
      const page = await listAs(teacher, Role.Teacher, school, 50, 1);

      expect(page.items).toEqual([]);
      expect(page.total).toBe(1);
    });
  });

  describe('soft deletion', () => {
    it('excludes a removed member without an explicit filter', async () => {
      // The action adds no deletedAt condition: the entity carries a
      // @DeleteDateColumn and TypeORM's query builder excludes soft-deleted
      // rows on its own. Asserted rather than assumed, because a silent change
      // in that behaviour would start listing people who were removed.
      const removed = '55555555-5555-4555-8555-555555555555';
      await seedMember(owner, school, removed, [Role.Staff], { deleted: true });

      try {
        const page = await listAs(admin, Role.SchoolAdmin);

        expect(page.items.map((member) => member.userId)).not.toContain(removed);
        expect(page.total).toBe(3);
      } finally {
        await owner.query(
          `DELETE FROM staff WHERE membership_id IN (SELECT id FROM memberships WHERE user_id = $1)`,
          [removed],
        );
        await owner.query(`DELETE FROM memberships WHERE user_id = $1`, [removed]);
      }
    });
  });

  describe('the Role enum and the database enum agree', () => {
    it('has exactly the same values', async () => {
      // The comment on the Role enum claims these are kept in step by a test.
      // This is that test. A value added to the database and not to the enum is
      // a role the application silently grants nothing to, and a value added to
      // the enum and not the database is a role no row can ever hold.
      const rows = await owner.query<Array<{ value: string }>>(`
        SELECT unnest(enum_range(NULL::memberships_role_enum))::text AS value
      `);

      expect(rows.map((row) => row.value).sort()).toEqual([...ROLES].sort());
    });
  });

  describe('the permission matrix against real data', () => {
    it('lets every seeded role reach the members endpoint', () => {
      // All five hold MembershipRead by design: the permission admits them and
      // the access scope decides how much they see. If this ever fails, the
      // matrix and the scope have drifted apart.
      for (const role of ROLES) {
        expect(roleHasPermission(role, Permission.MembershipRead)).toBe(true);
      }
    });
  });
});
