import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';
import { AttendanceStatus } from '../attendance.enums';

/**
 * One change to one attendance record.
 *
 * Blueprint section 96. Nothing in the application writes these rows: the
 * `record_attendance_correction` trigger does, from the old and new row, and it
 * refuses an update that carries no reason. The application role holds SELECT
 * and INSERT only, with UPDATE and DELETE revoked, so a trail cannot be edited
 * by the thing it is a trail of.
 *
 * `changedBy` is a membership, like `Attendance.markedBy`, and is resolved by
 * the trigger from the session's user rather than supplied by a caller.
 */
@Entity('attendance_corrections')
export class AttendanceCorrection extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'attendance_id' })
  attendanceId!: string;

  @Column({
    type: 'enum',
    enum: AttendanceStatus,
    enumName: 'attendance_status_enum',
    name: 'previous_status',
  })
  previousStatus!: AttendanceStatus;

  @Column({
    type: 'enum',
    enum: AttendanceStatus,
    enumName: 'attendance_status_enum',
    name: 'new_status',
  })
  newStatus!: AttendanceStatus;

  /** Why the change was made. Never empty: a check constraint refuses blanks. */
  @Column({ type: 'text', name: 'reason' })
  reason!: string;

  @Column({ type: 'uuid', name: 'changed_by' })
  changedBy!: string;

  @Column({ type: 'timestamptz', name: 'changed_at' })
  changedAt!: Date;
}
