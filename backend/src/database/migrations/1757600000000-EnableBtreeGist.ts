import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enables `btree_gist`, which the academic spine needs for one constraint.
 *
 * Terms in a session must not overlap, and neither must sessions in a school.
 * The only way to make that impossible, rather than unlikely, is an exclusion
 * constraint mixing an equality (`session_id WITH =`) with a range overlap
 * (`daterange(...) WITH &&`). A GiST index handles the range half natively, but
 * the equality half on a uuid needs `btree_gist`.
 *
 * The alternative, checking for overlap in application code, fails under
 * concurrent writes: two admins adding terms at once can each read an empty
 * calendar and both commit. An exclusion constraint is checked by Postgres
 * under its own locking, so exactly one succeeds.
 *
 * A standard contrib extension, shipped with Postgres and available on
 * Supabase. Kept in its own migration so the reason for it is not buried in
 * the table definitions.
 */
export class EnableBtreeGist1757600000000 implements MigrationInterface {
  name = 'EnableBtreeGist1757600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist`);
  }

  public async down(): Promise<void> {
    // Deliberately empty, as with the other extension migration. Dropping an
    // extension that later constraints depend on would fail, and on a shared
    // database another schema may use it too.
  }
}
