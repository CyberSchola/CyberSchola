import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sessions, terms, grade levels, classes and subjects.
 *
 * The structural half of the academic spine, in the order blueprint section 22
 * requires: sessions, then terms, then classes, then subjects.
 *
 * ## Every reference between tenant-owned tables carries the tenant
 *
 * This is the part worth reading first, because it is not the obvious shape.
 *
 * A foreign key check in Postgres runs with the table owner's privileges, so it
 * does **not** respect row-level security. Verified directly before this was
 * written: with a plain `parent_id REFERENCES parent(id)`, the application
 * acting in school A inserted a row pointing at a parent belonging to school B,
 * a row it could not even see. `WITH CHECK` only validates the new row's own
 * `tenant_id`; it says nothing about the tenant of whatever that row points at.
 *
 * So every reference here is composite, `(tenant_id, x_id) REFERENCES
 * x (tenant_id, id)`, which makes a cross-school reference a foreign key
 * violation rather than a quiet corruption. Each referenced table therefore
 * carries `UNIQUE (tenant_id, id)`. Nothing merged before this had the hole,
 * because until now tenant-owned tables only referenced `tenants` itself; the
 * spine is the first place they reference each other.
 *
 * ## A class belongs to a session
 *
 * `JSS2A` in 2026/27 is a different row from `JSS2A` in 2027/28. The session is
 * stated once, on the class, and every enrolment and assignment inherits it by
 * pointing at the class. Renaming an arm next year cannot rewrite last year's
 * history, and "which class was this student in during 2025/26" is a join
 * rather than a reconstruction.
 */
export class CreateAcademicStructure1757600100000 implements MigrationInterface {
  name = 'CreateAcademicStructure1757600100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /**
     * An academic year, such as 2026/2027.
     *
     * Exactly one may be current per school, enforced by the partial unique
     * index below rather than by application code, so two administrators
     * switching the current session at the same moment cannot leave two.
     */
    await queryRunner.query(`
      CREATE TABLE academic_sessions (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name        citext NOT NULL,
        starts_on   date NOT NULL,
        ends_on     date NOT NULL,
        is_current  boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz,
        deleted_by  uuid,
        archived_at timestamptz,
        CONSTRAINT academic_sessions_dates_ordered CHECK (starts_on < ends_on),
        CONSTRAINT academic_sessions_tenant_id_unique UNIQUE (tenant_id, id),
        -- Sessions in one school must not overlap. See EnableBtreeGist for why
        -- this is a constraint and not an application check.
        CONSTRAINT academic_sessions_no_overlap EXCLUDE USING gist (
          tenant_id WITH =,
          daterange(starts_on, ends_on, '[]') WITH &&
        ) WHERE (deleted_at IS NULL)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX academic_sessions_name_unique_live
      ON academic_sessions (tenant_id, name) WHERE deleted_at IS NULL
    `);

    // One current session per school. Switching it is two statements in one
    // transaction: clear the old flag, then set the new one. Setting first
    // would briefly hold two and this index would reject it.
    await queryRunner.query(`
      CREATE UNIQUE INDEX academic_sessions_one_current
      ON academic_sessions (tenant_id) WHERE is_current AND deleted_at IS NULL
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('academic_sessions')`);

    /**
     * A term within a session: First, Second, Third.
     *
     * Two constraints do the real work. The exclusion constraint stops two terms
     * in one session overlapping, which would otherwise make "which term is
     * today" ambiguous and put attendance recorded in the overlap in both terms
     * or neither. The trigger below keeps every term inside its session's dates,
     * which a CHECK cannot do because it spans two tables.
     */
    await queryRunner.query(`
      CREATE TABLE terms (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        session_id  uuid NOT NULL,
        name        citext NOT NULL,
        starts_on   date NOT NULL,
        ends_on     date NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz,
        deleted_by  uuid,
        archived_at timestamptz,
        CONSTRAINT terms_dates_ordered CHECK (starts_on < ends_on),
        CONSTRAINT terms_tenant_id_unique UNIQUE (tenant_id, id),
        CONSTRAINT terms_session_fk FOREIGN KEY (tenant_id, session_id)
          REFERENCES academic_sessions (tenant_id, id),
        CONSTRAINT terms_no_overlap EXCLUDE USING gist (
          session_id WITH =,
          daterange(starts_on, ends_on, '[]') WITH &&
        ) WHERE (deleted_at IS NULL)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX terms_name_unique_live
      ON terms (session_id, name) WHERE deleted_at IS NULL
    `);

    /**
     * Keeps a term inside its session, from both directions.
     *
     * A term being inserted or moved must fit its session. A session being
     * shortened must still contain every one of its terms, or it would strand a
     * term outside the year it belongs to. Both run as the invoking role, so
     * row-level security applies to the lookups exactly as it does to anything
     * else; the composite foreign key has already guaranteed the session is in
     * the same school.
     */
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION enforce_term_within_session() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        session_start date;
        session_end   date;
      BEGIN
        IF NEW.deleted_at IS NOT NULL THEN
          RETURN NEW;
        END IF;

        SELECT starts_on, ends_on INTO session_start, session_end
          FROM academic_sessions
         WHERE id = NEW.session_id AND tenant_id = NEW.tenant_id;

        IF NOT FOUND THEN
          -- The foreign key reports this more precisely.
          RETURN NEW;
        END IF;

        IF NEW.starts_on < session_start OR NEW.ends_on > session_end THEN
          RAISE EXCEPTION
            'Term "%" (% to %) falls outside its session (% to %).',
            NEW.name, NEW.starts_on, NEW.ends_on, session_start, session_end
            USING ERRCODE = 'check_violation';
        END IF;

        RETURN NEW;
      END
      $$
    `);

    await queryRunner.query(`
      CREATE TRIGGER terms_within_session
      BEFORE INSERT OR UPDATE OF starts_on, ends_on, session_id, deleted_at ON terms
      FOR EACH ROW EXECUTE FUNCTION enforce_term_within_session()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION enforce_session_contains_terms() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM terms t
           WHERE t.session_id = NEW.id
             AND t.tenant_id = NEW.tenant_id
             AND t.deleted_at IS NULL
             AND (t.starts_on < NEW.starts_on OR t.ends_on > NEW.ends_on)
        ) THEN
          RAISE EXCEPTION
            'Session "%" cannot be narrowed to % to %: a term would fall outside it.',
            NEW.name, NEW.starts_on, NEW.ends_on
            USING ERRCODE = 'check_violation';
        END IF;

        RETURN NEW;
      END
      $$
    `);

    await queryRunner.query(`
      CREATE TRIGGER sessions_contain_terms
      BEFORE UPDATE OF starts_on, ends_on ON academic_sessions
      FOR EACH ROW EXECUTE FUNCTION enforce_session_contains_terms()
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('terms')`);

    /**
     * A grade level: JSS 1, SS 2, Primary 4.
     *
     * Per school rather than an enum, because a primary school runs Nursery 1 to
     * Primary 6 and has no JSS at all. Ordered by `position`, which is what
     * promotion will need: JSS 2 moves to the next position, JSS 3.
     *
     * Separate from the class because the blueprint queries at this level across
     * arms, such as "JSS 2 attendance this week".
     */
    await queryRunner.query(`
      CREATE TABLE grade_levels (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name        citext NOT NULL,
        position    integer NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz,
        deleted_by  uuid,
        archived_at timestamptz,
        CONSTRAINT grade_levels_position_non_negative CHECK (position >= 0),
        CONSTRAINT grade_levels_tenant_id_unique UNIQUE (tenant_id, id)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX grade_levels_name_unique_live
      ON grade_levels (tenant_id, name) WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX grade_levels_position_unique_live
      ON grade_levels (tenant_id, position) WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('grade_levels')`);

    /**
     * A class: a grade level and an arm, within one session. JSS 2 + "A".
     *
     * `UNIQUE (tenant_id, id, session_id)` looks redundant next to the primary
     * key and is not. It is the target enrolments reference so they can carry
     * the session as well as the class, which is what lets the database forbid
     * one student being enrolled in two classes in the same session. The
     * composite key makes that copy of the session impossible to get wrong.
     */
    await queryRunner.query(`
      CREATE TABLE classes (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        session_id      uuid NOT NULL,
        grade_level_id  uuid NOT NULL,
        arm             citext NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        deleted_at      timestamptz,
        deleted_by      uuid,
        archived_at     timestamptz,
        CONSTRAINT classes_tenant_id_unique UNIQUE (tenant_id, id),
        CONSTRAINT classes_tenant_id_session_unique UNIQUE (tenant_id, id, session_id),
        CONSTRAINT classes_session_fk FOREIGN KEY (tenant_id, session_id)
          REFERENCES academic_sessions (tenant_id, id),
        CONSTRAINT classes_grade_level_fk FOREIGN KEY (tenant_id, grade_level_id)
          REFERENCES grade_levels (tenant_id, id)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX classes_session_grade_arm_unique_live
      ON classes (session_id, grade_level_id, arm) WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('classes')`);

    /** A subject a school teaches: Mathematics, Physics. Not tied to a session. */
    await queryRunner.query(`
      CREATE TABLE subjects (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name        citext NOT NULL,
        code        citext,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        deleted_at  timestamptz,
        deleted_by  uuid,
        archived_at timestamptz,
        CONSTRAINT subjects_tenant_id_unique UNIQUE (tenant_id, id)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX subjects_name_unique_live
      ON subjects (tenant_id, name) WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('subjects')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS subjects`);
    await queryRunner.query(`DROP TABLE IF EXISTS classes`);
    await queryRunner.query(`DROP TABLE IF EXISTS grade_levels`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS sessions_contain_terms ON academic_sessions`);
    await queryRunner.query(`DROP TABLE IF EXISTS terms`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS enforce_session_contains_terms()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS enforce_term_within_session()`);
    await queryRunner.query(`DROP TABLE IF EXISTS academic_sessions`);
  }
}
