import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The people of a school, as records that exist before anyone has a login.
 *
 * ## Records first, accounts later
 *
 * A school enrols a class of eleven-year-olds long before any of them signs in,
 * and many never will. So a student, teacher, parent or staff record no longer
 * needs a membership: `membership_id` is nullable, and an administrator links a
 * login to the record once the person has one. The composite foreign key to
 * memberships still holds whenever the column is set, because Postgres checks a
 * multi-column key only when every column in it is non-null.
 *
 * `school_admins` is the exception. An administrator with no login cannot
 * administer anything, so that link is required.
 *
 * ## These rows are the roles
 *
 * From this phase on, a person's roles in a school are the role rows that point
 * at their membership, read through the `membership_roles` view. A teacher whose
 * child attends the same school has a teacher row and a parent row on one
 * membership. See the next three migrations: the backfill, the view, and the
 * removal of `memberships.role`.
 *
 * ## Tenant-safe throughout
 *
 * Every reference between tenant-owned tables includes `tenant_id`, because a
 * foreign key check does not respect row-level security. The schema conformance
 * suite fails the build on any that does not.
 */
export class CreatePeopleTables1757700000000 implements MigrationInterface {
  name = 'CreatePeopleTables1757700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // -----------------------------------------------------------------------
    // Students and teachers gain names, and stop requiring a login.
    // -----------------------------------------------------------------------

    for (const table of ['students', 'teachers']) {
      await queryRunner.query(`ALTER TABLE ${table} ALTER COLUMN membership_id DROP NOT NULL`);

      // NOT NULL with a temporary default so existing rows are valid, then the
      // default is dropped so every new record has to name the person. Rows that
      // existed before this migration carry empty names until an administrator
      // fills them in; the API refuses an empty name on create and update.
      await queryRunner.query(`
        ALTER TABLE ${table}
          ADD COLUMN first_name text NOT NULL DEFAULT '',
          ADD COLUMN last_name  text NOT NULL DEFAULT ''
      `);
      await queryRunner.query(`
        ALTER TABLE ${table}
          ALTER COLUMN first_name DROP DEFAULT,
          ALTER COLUMN last_name  DROP DEFAULT
      `);
    }

    // A student's profile. Deliberately small: every column here is personal data
    // that the API has to decide who may see.
    await queryRunner.query(`
      ALTER TABLE students
        ADD COLUMN other_names      text,
        ADD COLUMN date_of_birth    date,
        ADD COLUMN admission_number citext
    `);

    // Unique per school while live, and only when set. citext, so "CS/001" and
    // "cs/001" are the same number.
    await queryRunner.query(`
      CREATE UNIQUE INDEX students_admission_number_unique_live
      ON students (tenant_id, admission_number)
      WHERE deleted_at IS NULL AND admission_number IS NOT NULL
    `);

    // -----------------------------------------------------------------------
    // Parents, staff and administrators.
    // -----------------------------------------------------------------------

    await queryRunner.query(`
      CREATE TABLE parents (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        membership_id uuid,
        first_name    text NOT NULL,
        last_name     text NOT NULL,
        email         citext,
        phone         text,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        deleted_at    timestamptz,
        deleted_by    uuid,
        archived_at   timestamptz,
        CONSTRAINT parents_tenant_id_unique UNIQUE (tenant_id, id),
        CONSTRAINT parents_membership_fk FOREIGN KEY (tenant_id, membership_id)
          REFERENCES memberships (tenant_id, id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE staff (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        membership_id uuid,
        first_name    text NOT NULL,
        last_name     text NOT NULL,
        job_title     text,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        deleted_at    timestamptz,
        deleted_by    uuid,
        archived_at   timestamptz,
        CONSTRAINT staff_tenant_id_unique UNIQUE (tenant_id, id),
        CONSTRAINT staff_membership_fk FOREIGN KEY (tenant_id, membership_id)
          REFERENCES memberships (tenant_id, id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE school_admins (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        membership_id uuid NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        deleted_at    timestamptz,
        deleted_by    uuid,
        archived_at   timestamptz,
        CONSTRAINT school_admins_tenant_id_unique UNIQUE (tenant_id, id),
        CONSTRAINT school_admins_membership_fk FOREIGN KEY (tenant_id, membership_id)
          REFERENCES memberships (tenant_id, id)
      )
    `);

    // One live row per membership per role table, which is what "holds the role
    // once" means. students and teachers already have theirs from BE-S01. These
    // indexes are also what the role lookup probes on every request.
    for (const table of ['parents', 'staff', 'school_admins']) {
      await queryRunner.query(`
        CREATE UNIQUE INDEX ${table}_membership_unique_live
        ON ${table} (membership_id) WHERE deleted_at IS NULL
      `);
    }

    // -----------------------------------------------------------------------
    // Guardianship: which parents may see which children.
    // -----------------------------------------------------------------------

    await queryRunner.query(`
      CREATE TYPE guardianships_relationship_enum AS ENUM ('MOTHER', 'FATHER', 'GUARDIAN', 'OTHER')
    `);

    await queryRunner.query(`
      CREATE TABLE guardianships (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        parent_id    uuid NOT NULL,
        student_id   uuid NOT NULL,
        relationship guardianships_relationship_enum NOT NULL DEFAULT 'GUARDIAN',
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        deleted_at   timestamptz,
        deleted_by   uuid,
        archived_at  timestamptz,
        CONSTRAINT guardianships_parent_fk FOREIGN KEY (tenant_id, parent_id)
          REFERENCES parents (tenant_id, id),
        CONSTRAINT guardianships_student_fk FOREIGN KEY (tenant_id, student_id)
          REFERENCES students (tenant_id, id)
      )
    `);

    // One live link per parent and child. Leads with parent_id, which is also the
    // path the parent scope takes from the acting parent to their children.
    await queryRunner.query(`
      CREATE UNIQUE INDEX guardianships_parent_student_unique_live
      ON guardianships (parent_id, student_id) WHERE deleted_at IS NULL
    `);

    // The other direction: whose child is this, as the scope tests it per row.
    await queryRunner.query(`
      CREATE INDEX guardianships_student_live_idx
      ON guardianships (student_id) WHERE deleted_at IS NULL
    `);

    for (const table of ['parents', 'staff', 'school_admins', 'guardianships']) {
      await queryRunner.query(`SELECT apply_tenant_isolation('${table}')`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS guardianships`);
    await queryRunner.query(`DROP TYPE IF EXISTS guardianships_relationship_enum`);
    await queryRunner.query(`DROP TABLE IF EXISTS school_admins`);
    await queryRunner.query(`DROP TABLE IF EXISTS staff`);
    await queryRunner.query(`DROP TABLE IF EXISTS parents`);

    await queryRunner.query(`DROP INDEX IF EXISTS students_admission_number_unique_live`);
    await queryRunner.query(`
      ALTER TABLE students
        DROP COLUMN IF EXISTS admission_number,
        DROP COLUMN IF EXISTS date_of_birth,
        DROP COLUMN IF EXISTS other_names
    `);

    for (const table of ['students', 'teachers']) {
      await queryRunner.query(`
        ALTER TABLE ${table} DROP COLUMN IF EXISTS first_name, DROP COLUMN IF EXISTS last_name
      `);

      // Records without a login cannot be represented in the older schema.
      // Refuse rather than delete them: a revert that silently removes students
      // is worse than a revert that stops and says why.
      await queryRunner.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM ${table} WHERE membership_id IS NULL) THEN
            RAISE EXCEPTION
              'Cannot revert: ${table} holds records with no linked membership, which the '
              'previous schema cannot represent. Link or remove them first.';
          END IF;
        END
        $$;
      `);
      await queryRunner.query(`ALTER TABLE ${table} ALTER COLUMN membership_id SET NOT NULL`);
    }
  }
}
