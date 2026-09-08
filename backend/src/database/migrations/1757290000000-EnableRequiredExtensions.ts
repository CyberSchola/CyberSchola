import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enables the Postgres extensions the schema depends on.
 *
 * Deliberately the first migration, so that later ones can assume these exist
 * rather than each re-declaring them.
 *
 * - `pgcrypto` gives `gen_random_uuid()`. Primary keys are random rather than
 *   sequential so that an id reveals nothing about how many rows exist or the
 *   order they were created in. That matters in a multi-tenant system, where a
 *   sequential id also leaks the rate at which other schools are using the
 *   platform.
 * - `citext` gives case-insensitive text. Email addresses and school codes
 *   compare case-insensitively, and doing that with `lower()` on every query
 *   is both easy to forget and unable to use a plain unique index.
 *
 * Every statement is idempotent, so applying this to a Supabase project that
 * already has the extensions is a no-op rather than an error.
 */
export class EnableRequiredExtensions1757290000000 implements MigrationInterface {
  name = 'EnableRequiredExtensions1757290000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);
  }

  public async down(): Promise<void> {
    // Deliberately empty.
    //
    // Dropping an extension would break every column still using its types,
    // and on Supabase these may have been enabled by the platform or by
    // another part of the project rather than by this migration. Reverting
    // this migration should undo what it added to *our* schema, which is
    // nothing, and must not reach outside that.
  }
}
