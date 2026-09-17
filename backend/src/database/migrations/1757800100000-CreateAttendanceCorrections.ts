import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The trail behind every change to an attendance record.
 *
 * Blueprint section 96: a status must never be silently overwritten, and a
 * change has to record the previous status, the new one, who made it, why, and
 * when. Its stated purpose is preventing disputes and accidental manipulation,
 * which is only worth anything if the trail cannot be skipped.
 *
 * ## Written by the database, not by the service
 *
 * A service method that writes the history row beside the update is correct
 * until the second write path exists. Then there is an import, or a job, or a
 * one-off fix run against the database during an incident, and none of them
 * know about the rule. Earlier phases of this codebase produced three defects of
 * exactly that shape: a guarantee that was described in a comment and never
 * actually enforced anywhere.
 *
 * So the trigger below writes the row itself, from OLD and NEW, and refuses the
 * update when no reason has been set on the transaction. There is no way to
 * change a status without a trail, including from psql.
 *
 * ## How the reason arrives
 *
 * The same way the tenant and the user do: a transaction-local setting, which is
 * already how this codebase carries request identity into the database.
 *
 *     SELECT set_config('app.attendance_reason', $1, true);
 *     UPDATE attendance SET status = $2 WHERE id = $3;
 *
 * `true` makes it transaction-local, so it cannot leak into the next statement
 * on a pooled connection, and it is set through a parameter rather than
 * interpolated, so a hostile reason stays data.
 *
 * ## Who changed it
 *
 * Resolved by the trigger from the session's user, against the memberships of
 * the school that owns the row, so it is the same kind of identity as
 * `marked_by` and cannot be supplied by the caller at all. A correction by
 * someone who is not a member of that school has nothing to record and is
 * refused.
 *
 * ## Append only
 *
 * `apply_tenant_isolation` grants the application role the usual DML, and UPDATE
 * and DELETE are then revoked. A trail that the application can edit is not a
 * trail. Migrations run as the owner and can still correct the table if they
 * ever have to, which is the level at which that should require a deliberate act.
 */
export class CreateAttendanceCorrections1757800100000 implements MigrationInterface {
  name = 'CreateAttendanceCorrections1757800100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE attendance_corrections (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        attendance_id   uuid NOT NULL,
        previous_status attendance_status_enum NOT NULL,
        new_status      attendance_status_enum NOT NULL,
        reason          text NOT NULL,
        changed_by      uuid NOT NULL,
        changed_at      timestamptz NOT NULL DEFAULT now(),
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        deleted_at      timestamptz,
        deleted_by      uuid,
        archived_at     timestamptz,

        CONSTRAINT attendance_corrections_tenant_id_unique UNIQUE (tenant_id, id),

        -- A correction that changed nothing is not a correction, and would let
        -- someone bury a real change under noise.
        CONSTRAINT attendance_corrections_status_changed CHECK (previous_status <> new_status),

        -- An empty reason is the same as no reason.
        CONSTRAINT attendance_corrections_reason_present CHECK (btrim(reason) <> ''),

        CONSTRAINT attendance_corrections_attendance_fk FOREIGN KEY (tenant_id, attendance_id)
          REFERENCES attendance (tenant_id, id),
        CONSTRAINT attendance_corrections_changed_by_fk FOREIGN KEY (tenant_id, changed_by)
          REFERENCES memberships (tenant_id, id)
      )
    `);

    // The history of one record, newest first, which is how it is read.
    await queryRunner.query(`
      CREATE INDEX attendance_corrections_record_idx
      ON attendance_corrections (tenant_id, attendance_id, changed_at DESC)
    `);

    await queryRunner.query(`SELECT apply_tenant_isolation('attendance_corrections')`);

    // Append only, as above. SELECT and INSERT remain.
    await queryRunner.query(`
      REVOKE UPDATE, DELETE ON attendance_corrections FROM cyberschola_app
    `);

    // -----------------------------------------------------------------------
    // The trigger.
    // -----------------------------------------------------------------------

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION record_attendance_correction() RETURNS trigger AS $$
      DECLARE
        change_reason text := NULLIF(btrim(current_setting('app.attendance_reason', true)), '');
        actor_membership uuid;
      BEGIN
        IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
          RETURN NEW;
        END IF;

        IF change_reason IS NULL THEN
          RAISE EXCEPTION
            'Attendance cannot change without a reason. Set app.attendance_reason on the '
            'transaction, which AttendanceService.correct does, so the change is recorded.'
            USING ERRCODE = '23514';
        END IF;

        SELECT id INTO actor_membership
          FROM memberships
         WHERE tenant_id = OLD.tenant_id
           AND user_id = current_user_id()
           AND deleted_at IS NULL
         LIMIT 1;

        IF actor_membership IS NULL THEN
          RAISE EXCEPTION
            'Attendance can only be corrected by a member of the school that owns the record.'
            USING ERRCODE = '23514';
        END IF;

        INSERT INTO attendance_corrections
          (tenant_id, attendance_id, previous_status, new_status, reason, changed_by)
        VALUES
          (OLD.tenant_id, OLD.id, OLD.status, NEW.status, change_reason, actor_membership);

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER record_attendance_correction_trigger
      BEFORE UPDATE OF status ON attendance
      FOR EACH ROW EXECUTE FUNCTION record_attendance_correction()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS record_attendance_correction_trigger ON attendance
    `);
    await queryRunner.query(`DROP FUNCTION IF EXISTS record_attendance_correction()`);
    await queryRunner.query(`DROP TABLE IF EXISTS attendance_corrections`);
  }
}
