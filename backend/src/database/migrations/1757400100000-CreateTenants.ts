import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The tenants table, and the machinery every tenant-owned table will reuse.
 *
 * Three pieces land together because none of them is useful alone:
 *
 * 1. `app.current_tenant`, the session setting the policies read.
 * 2. `current_tenant_id()`, a helper so every future policy is one expression
 *    rather than a copied snippet that can drift.
 * 3. The tenants table itself, which everything else references.
 */
export class CreateTenants1757400100000 implements MigrationInterface {
  name = 'CreateTenants1757400100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /**
     * Reads the tenant for the current transaction.
     *
     * `current_setting(..., true)` returns NULL rather than raising when the
     * setting is absent, which matters: a query issued without a tenant
     * context must return nothing, not error. A policy comparing against NULL
     * is never true, so an unset context is a closed door rather than an open
     * one.
     *
     * STABLE, not IMMUTABLE: the value is fixed within a statement but differs
     * between transactions. Marking it IMMUTABLE would let the planner cache a
     * result across transactions, which would hand one tenant another's rows.
     */
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$
        SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenants_status_enum') THEN
          CREATE TYPE tenants_status_enum AS ENUM ('ACTIVE', 'ARCHIVED', 'SOFT_DELETED');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name        text NOT NULL,
        slug        citext NOT NULL,
        status      tenants_status_enum NOT NULL DEFAULT 'ACTIVE',
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz,
        archived_at timestamptz
      );
    `);

    /**
     * Unique among live schools only.
     *
     * A plain UNIQUE constraint would keep a soft-deleted school's slug
     * reserved forever, so recreating a school deleted by mistake would fail
     * on a name nobody can see. This is decision 8A, and it is the reason every
     * unique index on a soft-deletable table has to be partial.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_unique_live
      ON tenants (slug)
      WHERE deleted_at IS NULL;
    `);

    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenants TO cyberschola_app;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tenants`);
    await queryRunner.query(`DROP TYPE IF EXISTS tenants_status_enum`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS current_tenant_id()`);
  }
}
