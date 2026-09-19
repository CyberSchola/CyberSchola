import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

import { ROLES } from '../src/auth/permission.matrix';
import { migrationDataSourceOptions } from '../src/database/data-source';
import { integrationDatabaseUrl, resetSchema } from './database.setup';

/**
 * Upgrading a database that already has members, which is the only upgrade that
 * matters.
 *
 * BE-P01 moves roles off `memberships.role` and onto role rows, then drops the
 * column. A fresh install never exercises the copy: there is nothing to copy. So
 * this suite migrates to the schema just before the backfill, seeds memberships of
 * every role in every state they can be in, runs the rest of the chain, and checks
 * that every person kept exactly the role they had. If the backfill missed a role
 * or a state, those people would be locked out on deploy, and an administrator
 * locked out cannot fix it.
 */
describe('the role backfill, on a database with existing members', () => {
  const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'database', 'migrations');
  const BACKFILL = '1757700100000';
  const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  /** Migration files up to, but not including, a timestamp. */
  const migrationsBefore = (timestamp: string) =>
    readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.ts') && file < timestamp)
      .map((file) => join(MIGRATIONS_DIR, file));

  const dataSource = (migrations: string[]) =>
    new DataSource({
      ...migrationDataSourceOptions,
      url: integrationDatabaseUrl(),
      ssl: false,
      logging: ['error'],
      migrations,
      entities: [],
    });

  /** One member per role and state, keyed by a readable name. */
  const members = {
    admin: { user: '40000000-0000-4000-8000-000000000001', role: 'SCHOOL_ADMIN', state: 'active' },
    teacher: { user: '40000000-0000-4000-8000-000000000002', role: 'TEACHER', state: 'active' },
    student: { user: '40000000-0000-4000-8000-000000000003', role: 'STUDENT', state: 'active' },
    parent: { user: '40000000-0000-4000-8000-000000000004', role: 'PARENT', state: 'active' },
    staff: { user: '40000000-0000-4000-8000-000000000005', role: 'STAFF', state: 'active' },
    suspendedTeacher: {
      user: '40000000-0000-4000-8000-000000000006',
      role: 'TEACHER',
      state: 'suspended',
    },
    removedParent: {
      user: '40000000-0000-4000-8000-000000000007',
      role: 'PARENT',
      state: 'removed',
    },
    // Anchored through the BE-S01 API before this phase: a students row already
    // exists. The backfill must not create a second one.
    anchoredStudent: {
      user: '40000000-0000-4000-8000-000000000008',
      role: 'STUDENT',
      state: 'anchored',
    },
  } as const;

  let full: DataSource;

  beforeAll(async () => {
    const before = dataSource(migrationsBefore(BACKFILL));
    await before.initialize();
    await resetSchema(before);
    await before.runMigrations({ transaction: 'all' });

    await before.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Greenfield', 'greenfield')`,
      [SCHOOL],
    );

    for (const member of Object.values(members)) {
      const [row] = await before.query<Array<{ id: string }>>(
        `INSERT INTO memberships (tenant_id, user_id, role, status, deleted_at)
         VALUES ($1, $2, $3, $4, CASE WHEN $5::boolean THEN now() END)
         RETURNING id`,
        [
          SCHOOL,
          member.user,
          member.role,
          member.state === 'suspended' ? 'SUSPENDED' : 'ACTIVE',
          member.state === 'removed',
        ],
      );

      if (member.state === 'anchored') {
        await before.query(
          `INSERT INTO students (tenant_id, membership_id, first_name, last_name)
           VALUES ($1, $2, 'Already', 'Anchored')`,
          [SCHOOL, row.id],
        );
      }
    }

    await before.destroy();

    full = dataSource([join(MIGRATIONS_DIR, '*.ts')]);
    await full.initialize();
    await full.runMigrations({ transaction: 'all' });
  }, 120_000);

  afterAll(async () => {
    if (full?.isInitialized) await full.destroy();
  });

  /** Live roles per user, read through the view the application reads. */
  async function liveRoles(): Promise<Record<string, string[]>> {
    const rows = await full.query<Array<{ user_id: string; roles: string[] | null }>>(`
      SELECT m.user_id,
             array_agg(r.role::text ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL) AS roles
        FROM memberships m
        LEFT JOIN membership_roles r ON r.membership_id = m.id
       GROUP BY m.user_id
    `);

    return Object.fromEntries(rows.map((row) => [row.user_id, row.roles ?? []]));
  }

  it('drops memberships.role once the copy is done', async () => {
    const [row] = await full.query<Array<{ count: string }>>(`
      SELECT count(*)::text AS count FROM information_schema.columns
       WHERE table_name = 'memberships' AND column_name = 'role'
    `);

    expect(Number(row?.count)).toBe(0);
  });

  it.each(['admin', 'teacher', 'student', 'parent', 'staff'] as const)(
    'keeps the %s role for an active member',
    async (name) => {
      expect((await liveRoles())[members[name].user]).toEqual([members[name].role]);
    },
  );

  it('keeps the role of a suspended member, since suspension lives on the membership', async () => {
    expect((await liveRoles())[members.suspendedTeacher.user]).toEqual(['TEACHER']);
  });

  it('gives a removed member no live role, and keeps their role row as removed history', async () => {
    expect((await liveRoles())[members.removedParent.user]).toEqual([]);

    const [row] = await full.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM parents p
         JOIN memberships m ON m.id = p.membership_id
        WHERE m.user_id = $1 AND p.deleted_at IS NOT NULL`,
      [members.removedParent.user],
    );
    expect(Number(row?.count)).toBe(1);
  });

  it('does not duplicate a student who was already anchored', async () => {
    const [row] = await full.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM students s
         JOIN memberships m ON m.id = s.membership_id
        WHERE m.user_id = $1`,
      [members.anchoredStudent.user],
    );

    expect(Number(row?.count)).toBe(1);
    expect((await liveRoles())[members.anchoredStudent.user]).toEqual(['STUDENT']);
  });

  it('covers every role the application knows, so a new role cannot be left out of the backfill', () => {
    const seeded = new Set(Object.values(members).map((member) => member.role));

    expect([...seeded].sort()).toEqual([...ROLES].sort());
  });
});
