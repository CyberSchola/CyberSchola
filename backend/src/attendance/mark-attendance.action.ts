import type { EntityManager } from 'typeorm';

import { teacherSupervisesClass } from '../academics/teacher-access.scope';
import { Role } from '../auth/permission.matrix';
import { type AccessScope, unrestrictedScope } from '../common/actions/access-scope';
import { TenantScopedAction } from '../common/actions/tenant-scoped.action';
import { SchoolClass } from '../academics/entities/school-class.entity';
import { Attendance } from './entities/attendance.entity';
import { AttendanceType, type AttendanceStatus } from './attendance.enums';

/** The term a date falls in, and the session that term belongs to. */
export interface TermOnDate {
  readonly termId: string;
  readonly sessionId: string;
}

/** One student's line on the register. */
export interface RosterEntry {
  readonly studentId: string;
  readonly status: AttendanceStatus;
  readonly remarks?: string | null;
}

/** What one employee's record needs beyond the subject and the date. */
export interface EmployeeEntry {
  readonly status: AttendanceStatus;
  readonly checkInTime?: Date | null;
  readonly checkOutTime?: Date | null;
  readonly remarks?: string | null;
}

/**
 * Recording attendance.
 *
 * ## The access scope here is unrestricted, and that is not an omission
 *
 * This action returns no school data to a caller. Its reads are authorization
 * lookups, each one carrying the tenant explicitly and running under row-level
 * security, and its writes are checked by the constraints in migration
 * 1757800000000. The scope that decides whose attendance a caller may *see*
 * lives on `ReadAttendanceAction`, which is the only place rows leave.
 */
export class MarkAttendanceAction extends TenantScopedAction<Attendance> {
  constructor(manager: EntityManager) {
    super(manager, Attendance);
  }

  protected readonly accessScope: AccessScope<Attendance> = unrestrictedScope<Attendance>();

  /**
   * The term containing a date, in the current session.
   *
   * At most one: terms may not overlap within a session, and only one session is
   * current. No row means the school has no term covering that date, which is
   * how a register for a date in the holidays is refused.
   */
  async termOn(date: string): Promise<TermOnDate | null> {
    const rows = await this.manager.query<Array<{ term_id: string; session_id: string }>>(
      `SELECT term.id AS term_id, term.session_id AS session_id
         FROM terms term
         JOIN academic_sessions session
           ON session.id = term.session_id
          AND session.is_current
          AND session.deleted_at IS NULL
        WHERE term.tenant_id = $1
          AND term.deleted_at IS NULL
          AND $2::date BETWEEN term.starts_on AND term.ends_on
        LIMIT 1`,
      [this.tenantId, date],
    );

    const row = rows[0];

    return row ? { termId: row.term_id, sessionId: row.session_id } : null;
  }

  /**
   * Whether this caller may take the register for a class.
   *
   * An administrator may. A teacher may when they supervise the class in the
   * current session, per blueprint section 95. Nobody else, including a teacher
   * who merely teaches a subject in it, which is the distinction
   * `teacherSupervisesClass` exists to draw.
   */
  async mayMarkClass(classId: string): Promise<boolean> {
    const actor = this.actor;

    if (actor.roles.has(Role.SchoolAdmin)) {
      return this.classExists(classId);
    }

    if (!actor.roles.has(Role.Teacher)) {
      return false;
    }

    const supervises = teacherSupervisesClass('class.id', actor);

    return this.manager
      .createQueryBuilder(SchoolClass, 'class')
      .where('class.tenantId = :__tenantId', { __tenantId: this.tenantId })
      .andWhere('class.id = :__classId', { __classId: classId })
      .andWhere(supervises.sql, supervises.params)
      .getExists();
  }

  /** Whether a class exists in this school at all. */
  async classExists(classId: string): Promise<boolean> {
    return this.manager
      .createQueryBuilder(SchoolClass, 'class')
      .where('class.tenantId = :__tenantId', { __tenantId: this.tenantId })
      .andWhere('class.id = :__classId', { __classId: classId })
      .getExists();
  }

  /**
   * Which of these students already have a school-day record for a date.
   *
   * For the error message, not for correctness. The partial unique index is what
   * actually prevents a second record, including when two teachers save the same
   * register at the same moment and this check passes for both. Doing it here as
   * well means the ordinary case gets a 409 naming the students rather than a
   * bare constraint violation.
   */
  async alreadyMarked(
    date: string,
    column: 'student_id' | 'teacher_id' | 'staff_id',
    ids: readonly string[],
  ): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.manager.query<Array<{ subject_id: string }>>(
      `SELECT ${column} AS subject_id
         FROM attendance
        WHERE tenant_id = $1
          AND date = $2::date
          AND attendance_context = 'SCHOOL_DAY'
          AND deleted_at IS NULL
          AND ${column} = ANY($3::uuid[])`,
      [this.tenantId, date, [...ids]],
    );

    return rows.map((row) => row.subject_id);
  }

  /**
   * The acting person's membership of this school.
   *
   * What `marked_by` stores. Resolved per request rather than carried on the
   * context: an HTTP context holds the user and the roles, and the membership
   * row is what the foreign key needs. It is also a second check that the marker
   * is a live, active member, which is cheap next to the write it precedes.
   */
  async actingMembershipId(): Promise<string | null> {
    const rows = await this.manager.query<Array<{ id: string }>>(
      `SELECT id
         FROM memberships
        WHERE tenant_id = $1
          AND user_id = $2
          AND deleted_at IS NULL
          AND status = 'ACTIVE'
        LIMIT 1`,
      [this.tenantId, this.actor.userId],
    );

    return rows[0]?.id ?? null;
  }

  /**
   * Inserts a whole register in one statement.
   *
   * The roster is joined to `class_enrolments`, so the database decides who is
   * in the class and hands back the enrolment id, the class and the session for
   * the foreign key. A posted student who is not enrolled simply does not match
   * and is not inserted, which is why the caller compares the returned rows
   * against what it sent: a short result is the list of students who are not in
   * that class, and it is impossible for one of them to have been written.
   *
   * One round trip for forty students, and one transaction, so a failure part
   * way through leaves no half-marked register.
   */
  async insertRoster(options: {
    readonly classId: string;
    readonly term: TermOnDate;
    readonly date: string;
    readonly markedBy: string;
    readonly entries: readonly RosterEntry[];
  }): Promise<string[]> {
    const { classId, term, date, markedBy, entries } = options;

    // $1..$6 are the values every row shares; each entry then binds three more.
    const fixed = [this.tenantId, date, markedBy, term.termId, classId, term.sessionId];
    const values: unknown[] = [];
    const rows = entries.map((entry, index) => {
      const base = fixed.length + index * 3;

      values.push(entry.studentId, entry.status, entry.remarks ?? null);

      return `($${base + 1}::uuid, $${base + 2}::attendance_status_enum, $${base + 3}::text)`;
    });

    const inserted = await this.manager.query<Array<{ student_id: string }>>(
      `INSERT INTO attendance
         (tenant_id, attendance_type, attendance_context, date, status, remarks, marked_by,
          student_id, enrolment_id, class_id, session_id, term_id)
       SELECT $1, 'STUDENT', 'SCHOOL_DAY', $2::date, entry.status, entry.remarks, $3,
              enrolment.student_id, enrolment.id, enrolment.class_id, enrolment.session_id, $4
         FROM class_enrolments enrolment
         JOIN (VALUES ${rows.join(', ')}) AS entry(student_id, status, remarks)
           ON entry.student_id = enrolment.student_id
        WHERE enrolment.tenant_id = $1
          AND enrolment.class_id = $5
          AND enrolment.session_id = $6
          AND enrolment.deleted_at IS NULL
       RETURNING student_id`,
      [...fixed, ...values],
    );

    return inserted.map((row) => row.student_id);
  }

  /**
   * The acting person's own teacher or staff record.
   *
   * Self check-in needs it, and so does refusing a staff member who tries to
   * mark a colleague. Null when the caller holds no such record, which includes
   * a role row that exists with no login linked to it.
   */
  async ownRecordId(type: AttendanceType.Teacher | AttendanceType.Staff): Promise<string | null> {
    const table = type === AttendanceType.Teacher ? 'teachers' : 'staff';

    const rows = await this.manager.query<Array<{ id: string }>>(
      `SELECT person.id
         FROM ${table} person
         JOIN memberships membership
           ON membership.id = person.membership_id
          AND membership.deleted_at IS NULL
          AND membership.status = 'ACTIVE'
          AND membership.user_id = $2
        WHERE person.tenant_id = $1
          AND person.deleted_at IS NULL
        LIMIT 1`,
      [this.tenantId, this.actor.userId],
    );

    return rows[0]?.id ?? null;
  }

  /** Records one teacher's or staff member's day. */
  async insertEmployee(options: {
    readonly type: AttendanceType.Teacher | AttendanceType.Staff;
    readonly personId: string;
    readonly date: string;
    readonly markedBy: string;
    readonly entry: EmployeeEntry;
  }): Promise<Attendance> {
    const { type, personId, date, markedBy, entry } = options;

    return this.manager.save(
      this.buildScoped({
        attendanceType: type,
        date,
        status: entry.status,
        checkInTime: entry.checkInTime ?? null,
        checkOutTime: entry.checkOutTime ?? null,
        remarks: entry.remarks ?? null,
        markedBy,
        teacherId: type === AttendanceType.Teacher ? personId : null,
        staffId: type === AttendanceType.Staff ? personId : null,
      }),
    );
  }
}
