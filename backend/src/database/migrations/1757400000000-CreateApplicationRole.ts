import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the database role the application connects as.
 *
 * This migration is the difference between row-level security that works and
 * row-level security that is decoration. Supabase's `postgres` role and its
 * service key both carry `BYPASSRLS`, so an application connecting with either
 * sails past every policy while the whole test suite stays green. Decision 18A
 * exists because that failure is invisible from the application's side.
 *
 * The role created here has no `BYPASSRLS` and no `SUPERUSER`. It can read and
 * write the tables it is granted, and policies bind to it.
 *
 * **No password is set here, on purpose.** Migrations are committed and
 * reviewed, and a password in one is in the git history forever. The password
 * is set out of band, once, from the deployment environment:
 *
 *     ALTER ROLE cyberschola_app WITH PASSWORD '<from your secret store>';
 *
 * Until that runs the role cannot log in, which is the safe direction to fail.
 */
export class CreateApplicationRole1757400000000 implements MigrationInterface {
  name = 'CreateApplicationRole1757400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // CREATE ROLE has no IF NOT EXISTS, and a migration must be safe to re-run
    // against a database where a previous deploy already made it.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cyberschola_app') THEN
          CREATE ROLE cyberschola_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END
      $$;
    `);

    // Stated explicitly rather than relied on as the default, so that a role
    // created by hand at some point with the wrong attributes is corrected
    // rather than silently kept.
    await queryRunner.query(
      `ALTER ROLE cyberschola_app WITH NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`,
    );

    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO cyberschola_app`);

    // Data access only. No DDL: the application must never be able to drop a
    // policy, disable RLS, or alter a table. Schema changes go through
    // migrations, which run as the owner.
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE
      ON ALL TABLES IN SCHEMA public
      TO cyberschola_app
    `);
    await queryRunner.query(`
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cyberschola_app
    `);

    // Tables created by later migrations get the same grants without anyone
    // having to remember. Forgetting would surface as a confusing permission
    // error on a brand new table, long after this migration ran.
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cyberschola_app
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO cyberschola_app
    `);

    // The migrations table is read by TypeORM on connect. Read-only is enough:
    // the application never records a migration, only the CLI does.
    await queryRunner.query(`GRANT SELECT ON TABLE migrations TO cyberschola_app`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverting drops the grants but leaves the role. Dropping a role that
    // owns nothing is safe in principle, but on a shared database it may be in
    // use by a deployment this migration knows nothing about, and a failed
    // DROP ROLE would abort the whole revert.
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM cyberschola_app
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE USAGE, SELECT ON SEQUENCES FROM cyberschola_app
    `);
    await queryRunner.query(`
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM cyberschola_app
    `);
    await queryRunner.query(`
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM cyberschola_app
    `);
    await queryRunner.query(`REVOKE USAGE ON SCHEMA public FROM cyberschola_app`);
  }
}
