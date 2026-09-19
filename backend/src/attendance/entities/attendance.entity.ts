import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';
import { AttendanceContext, AttendanceStatus, AttendanceType } from '../attendance.enums';

/**
 * One person's attendance for one day.
 *
 * Students, teachers and staff share this table, per blueprint section 90. The
 * subject is three nullable columns rather than one polymorphic id, because a
 * reference between tenant-owned tables has to carry the tenant and a
 * polymorphic column can carry no foreign key at all. Migration
 * 1757800000000 has the reasoning in full, along with the check constraint that
 * keeps exactly one of them set and matching `attendanceType`.
 *
 * The four academic columns belong to a student record and travel together. The
 * foreign key spans all of `(tenantId, enrolmentId, classId, sessionId,
 * studentId)` against the enrolment, so a record cannot claim a class the
 * student was never enrolled in.
 */
@Entity('attendance')
export class Attendance extends TenantOwnedEntity {
  @Column({
    type: 'enum',
    enum: AttendanceType,
    enumName: 'attendance_type_enum',
    name: 'attendance_type',
  })
  attendanceType!: AttendanceType;

  @Column({
    type: 'enum',
    enum: AttendanceContext,
    enumName: 'attendance_context_enum',
    name: 'attendance_context',
    default: AttendanceContext.SchoolDay,
  })
  attendanceContext!: AttendanceContext;

  /** The school day, in the school's own calendar. */
  @Column({ type: 'date', name: 'date' })
  date!: string;

  @Column({
    type: 'enum',
    enum: AttendanceStatus,
    enumName: 'attendance_status_enum',
  })
  status!: AttendanceStatus;

  /**
   * Arrival and departure, where the school records them.
   *
   * `timestamptz` rather than a bare time, so a value is unambiguous about which
   * moment it refers to. Note that nothing currently checks these against
   * `date`: doing that needs the school's timezone, which arrives with the
   * school calendar. Until then the times are recorded as given.
   */
  @Column({ type: 'timestamptz', name: 'check_in_time', nullable: true })
  checkInTime!: Date | null;

  @Column({ type: 'timestamptz', name: 'check_out_time', nullable: true })
  checkOutTime!: Date | null;

  @Column({ type: 'text', name: 'remarks', nullable: true })
  remarks!: string | null;

  /**
   * The membership of the person who marked it.
   *
   * A membership rather than a user id, so the marker is a member of this school
   * by construction. Corrections do not change it: it stays the record of who
   * took the register, and the correction trail holds who changed it after.
   */
  @Column({ type: 'uuid', name: 'marked_by' })
  markedBy!: string;

  @Column({ type: 'uuid', name: 'student_id', nullable: true })
  studentId!: string | null;

  @Column({ type: 'uuid', name: 'teacher_id', nullable: true })
  teacherId!: string | null;

  @Column({ type: 'uuid', name: 'staff_id', nullable: true })
  staffId!: string | null;

  /** The enrolment that proves the student was in this class this session. */
  @Column({ type: 'uuid', name: 'enrolment_id', nullable: true })
  enrolmentId!: string | null;

  @Column({ type: 'uuid', name: 'class_id', nullable: true })
  classId!: string | null;

  @Column({ type: 'uuid', name: 'session_id', nullable: true })
  sessionId!: string | null;

  @Column({ type: 'uuid', name: 'term_id', nullable: true })
  termId!: string | null;
}
