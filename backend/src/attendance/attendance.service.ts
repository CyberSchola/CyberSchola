import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { Role, toRoles } from '../auth/permission.matrix';
import {
  ForbiddenException,
  ResourceConflictException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '../common/exceptions/app.exception';
import type { Page, PageRequest } from '../common/pagination/pagination';
import { getRequestContext, requireTenantId, requireUserId } from '../tenancy/request-context';
import { TenantTransactionService } from '../tenancy/tenant-transaction.service';
import {
  type AttendanceCorrectionDto,
  type AttendanceDto,
  type CorrectAttendanceDto,
  type MarkClassAttendanceDto,
  type MarkEmployeeAttendanceDto,
  type SelfCheckInDto,
} from './attendance.dto';
import { AttendanceStatus, AttendanceType, statusAllowedForType } from './attendance.enums';
import type { AttendanceCorrection } from './entities/attendance-correction.entity';
import type { Attendance } from './entities/attendance.entity';
import { MarkAttendanceAction } from './mark-attendance.action';
import { type AttendanceFilter, ReadAttendanceAction } from './read-attendance.action';
import { ReadAttendanceCorrectionsAction } from './read-attendance-corrections.action';

/** Why a register cannot be taken twice. Shared with the route's documentation. */
export const ALREADY_MARKED_MESSAGE =
  'Attendance has already been recorded for that day. Correct the existing record instead, ' +
  'so the change is recorded with a reason.';

/** Why a date can fall outside every term. Shared with the route's documentation. */
export const OUTSIDE_TERM_MESSAGE =
  'That date does not fall in any term of the current session, so there is no school day to mark.';

/**
 * Attendance, per blueprint sections 89 to 96.
 *
 * Three rules are worth naming here because they shape every method below.
 *
 * **Marking creates; changing is a separate act.** A register that silently
 * overwrote what was there would make section 96's trail optional in practice,
 * since the ordinary way to change a status would leave none. So marking refuses
 * a day that is already recorded and says which people it means, and correcting
 * is its own endpoint, its own permission and its own reason.
 *
 * **Whether a caller may use an endpoint is not whether they may touch this
 * row.** The permission on the route is the first question. Whether this teacher
 * supervises this class, and whether this staff member is marking themselves,
 * are decided here, per request. Whose records come back from a read is decided
 * by the access scope, in the query.
 *
 * **The database is the backstop for all of it.** Every rule enforced in this
 * file is also a constraint, an index or a trigger: one record per person per
 * day, a status a student may hold, a date inside its term, a correction with a
 * reason. This layer exists to turn those into clear answers, not to be the only
 * thing standing between a caller and a bad row.
 */
@Injectable()
export class AttendanceService {
  constructor(private readonly transactions: TenantTransactionService) {}

  // -------------------------------------------------------------------------
  // Marking
  // -------------------------------------------------------------------------

  /**
   * Takes a class register for one day.
   *
   * The order of the checks is deliberate: the class, then the caller's right to
   * mark it, then the day, then the roster. A caller who may not mark a class
   * learns nothing about what is already recorded in it.
   */
  markClass(classId: string, dto: MarkClassAttendanceDto): Promise<AttendanceDto[]> {
    return this.inSchool(async (manager) => {
      const marking = new MarkAttendanceAction(manager);

      if (!(await marking.classExists(classId))) {
        throw new ResourceNotFoundException();
      }

      if (!(await marking.mayMarkClass(classId))) {
        throw new ForbiddenException(
          'You can only record attendance for a class you supervise in the current session.',
        );
      }

      this.assertNotFuture(dto.date);
      this.assertDistinctStudents(dto.entries.map((entry) => entry.studentId));

      for (const entry of dto.entries) {
        this.assertStatusAllowed(AttendanceType.Student, entry.status);
      }

      const term = await marking.termOn(dto.date);

      if (term === null) {
        throw new ValidationFailedException([OUTSIDE_TERM_MESSAGE]);
      }

      const studentIds = dto.entries.map((entry) => entry.studentId);
      const marked = await marking.alreadyMarked(dto.date, 'student_id', studentIds);

      if (marked.length > 0) {
        throw new ResourceConflictException(
          `${ALREADY_MARKED_MESSAGE} Already recorded: ${marked.join(', ')}.`,
        );
      }

      const markedBy = await this.requireActingMembership(marking);
      const inserted = await marking.insertRoster({
        classId,
        term,
        date: dto.date,
        markedBy,
        entries: dto.entries,
      });

      this.assertEveryStudentEnrolled(studentIds, inserted);

      const saved = await new ReadAttendanceAction(manager).list(
        { classId, date: dto.date },
        { limit: studentIds.length, offset: 0 },
      );

      return saved.items.map(toAttendanceDto);
    });
  }

  /** Records a teacher's or staff member's day. Administrators only. */
  markEmployee(
    type: AttendanceType.Teacher | AttendanceType.Staff,
    personId: string,
    dto: MarkEmployeeAttendanceDto,
  ): Promise<AttendanceDto> {
    return this.inSchool(async (manager) => {
      const marking = new MarkAttendanceAction(manager);

      // Section 95 gives a staff member their own record and nothing else, so
      // anyone marking somebody else is doing an administrator's job.
      if (!this.actorRoles().has(Role.SchoolAdmin)) {
        const own = await marking.ownRecordId(type);

        if (own !== personId) {
          throw new ForbiddenException('You can only record your own attendance.');
        }
      }

      return this.recordEmployeeDay(marking, type, personId, {
        date: dto.date,
        status: dto.status,
        checkInTime: dto.checkInTime,
        checkOutTime: dto.checkOutTime,
        remarks: dto.remarks,
      });
    });
  }

  /**
   * A teacher or staff member recording their own arrival.
   *
   * The subject is the caller, resolved from their own role row, so there is no
   * id in the request that could name anyone else. A person holding both roles
   * checks in as a member of staff, because the staff record is the employment
   * one; a teacher who is also a parent is unaffected either way.
   */
  checkInSelf(dto: SelfCheckInDto): Promise<AttendanceDto> {
    return this.inSchool(async (manager) => {
      const marking = new MarkAttendanceAction(manager);
      const roles = this.actorRoles();

      const type = roles.has(Role.Staff)
        ? AttendanceType.Staff
        : roles.has(Role.Teacher)
          ? AttendanceType.Teacher
          : null;

      if (type === null) {
        throw new ForbiddenException('Only teachers and staff record their own attendance.');
      }

      const personId = await marking.ownRecordId(type);

      if (personId === null) {
        throw new ResourceNotFoundException(
          'Your account is not linked to a staff or teacher record in this school yet.',
        );
      }

      const now = new Date();

      return this.recordEmployeeDay(marking, type, personId, {
        date: dto.date ?? now.toISOString().slice(0, 10),
        status: dto.status ?? AttendanceStatus.Present,
        checkInTime: dto.checkInTime ?? now.toISOString(),
        remarks: dto.remarks,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /** One page of the records this caller may see. */
  list(filter: AttendanceFilter, page: PageRequest): Promise<Page<AttendanceDto>> {
    return this.inSchool(async (manager) => {
      const result = await new ReadAttendanceAction(manager).list(filter, page);

      return { ...result, items: result.items.map(toAttendanceDto) };
    });
  }

  /** One record, or 404 when it does not exist or is not this caller's to see. */
  get(id: string): Promise<AttendanceDto> {
    return this.inSchool(async (manager) => {
      return toAttendanceDto(await this.visible(new ReadAttendanceAction(manager), id));
    });
  }

  /** The changes made to a record, newest first. */
  corrections(id: string): Promise<AttendanceCorrectionDto[]> {
    return this.inSchool(async (manager) => {
      // A 404 for a record this caller may not see, so the answer does not say
      // whether a record exists. The history itself then comes from an action
      // whose own scope requires the record to be visible, so this check is a
      // courtesy and not the boundary.
      await this.visible(new ReadAttendanceAction(manager), id);

      return (await new ReadAttendanceCorrectionsAction(manager).forRecord(id)).map(
        toCorrectionDto,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Correcting
  // -------------------------------------------------------------------------

  /**
   * Changes a recorded status, leaving the trail section 96 asks for.
   *
   * The history row is not written here. The trigger writes it, from the old and
   * new row, and refuses the update when no reason is set on the transaction. So
   * this method cannot forget to record a change, and neither can anything else
   * that ever updates the table.
   */
  correct(id: string, dto: CorrectAttendanceDto): Promise<AttendanceDto> {
    return this.inSchool(async (manager) => {
      const reading = new ReadAttendanceAction(manager);
      const record = await this.visible(reading, id);

      this.assertStatusAllowed(record.attendanceType, dto.status);

      if (record.status === dto.status) {
        throw new ValidationFailedException([
          'That record already has this status, so there is nothing to correct.',
        ]);
      }

      return toAttendanceDto(await reading.correct(record, dto.status, dto.reason));
    });
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private async recordEmployeeDay(
    marking: MarkAttendanceAction,
    type: AttendanceType.Teacher | AttendanceType.Staff,
    personId: string,
    entry: {
      date: string;
      status: AttendanceStatus;
      checkInTime?: string;
      checkOutTime?: string;
      remarks?: string;
    },
  ): Promise<AttendanceDto> {
    this.assertNotFuture(entry.date);
    this.assertStatusAllowed(type, entry.status);

    const column = type === AttendanceType.Teacher ? 'teacher_id' : 'staff_id';
    const marked = await marking.alreadyMarked(entry.date, column, [personId]);

    if (marked.length > 0) {
      throw new ResourceConflictException(ALREADY_MARKED_MESSAGE);
    }

    const markedBy = await this.requireActingMembership(marking);

    return toAttendanceDto(
      await marking.insertEmployee({
        type,
        personId,
        date: entry.date,
        markedBy,
        entry: {
          status: entry.status,
          checkInTime: entry.checkInTime === undefined ? null : new Date(entry.checkInTime),
          checkOutTime: entry.checkOutTime === undefined ? null : new Date(entry.checkOutTime),
          remarks: entry.remarks ?? null,
        },
      }),
    );
  }

  /** A record this caller may see, or 404. */
  private async visible(reading: ReadAttendanceAction, id: string): Promise<Attendance> {
    const found = await reading.findVisible(id);

    if (found === null) {
      throw new ResourceNotFoundException();
    }

    return found;
  }

  private async requireActingMembership(marking: MarkAttendanceAction): Promise<string> {
    const membershipId = await marking.actingMembershipId();

    if (membershipId === null) {
      throw new ForbiddenException(
        'Your membership of this school is no longer active, so attendance cannot be recorded ' +
          'against it.',
      );
    }

    return membershipId;
  }

  /**
   * Refuses a register for a day that has not happened.
   *
   * Compared as calendar dates in UTC. The school's own timezone arrives with the
   * school calendar, and until it does this errs towards allowing today
   * everywhere rather than refusing it somewhere.
   */
  private assertNotFuture(date: string): void {
    if (date > new Date().toISOString().slice(0, 10)) {
      throw new ValidationFailedException(['Attendance cannot be recorded for a future date.']);
    }
  }

  private assertStatusAllowed(type: AttendanceType, status: AttendanceStatus): void {
    if (!statusAllowedForType(type, status)) {
      throw new ValidationFailedException([
        `${status} is not a status a ${type.toLowerCase()} record may hold.`,
      ]);
    }
  }

  /**
   * Refuses a roster naming the same student twice.
   *
   * The unique index would refuse the second row anyway, but as a conflict about
   * an existing record, which is a confusing thing to be told about a request
   * that conflicts with itself.
   */
  private assertDistinctStudents(studentIds: readonly string[]): void {
    const seen = new Set(studentIds);

    if (seen.size !== studentIds.length) {
      throw new ValidationFailedException(['entries must not name the same student twice']);
    }
  }

  /**
   * Refuses a roster naming somebody who is not in the class.
   *
   * The insert joins the roster to the enrolments, so a student who is not
   * enrolled produces no row rather than a wrong one. Comparing what came back
   * against what was sent is therefore both the check and its own proof: the
   * names below are exactly the entries the database declined to match.
   */
  private assertEveryStudentEnrolled(posted: readonly string[], inserted: readonly string[]): void {
    if (posted.length === inserted.length) {
      return;
    }

    const written = new Set(inserted);
    const missing = posted.filter((studentId) => !written.has(studentId));

    throw new ValidationFailedException([
      `Not enrolled in this class for the current session: ${missing.join(', ')}.`,
    ]);
  }

  /**
   * The caller's roles, as the request resolved them.
   *
   * Through `toRoles`, so a value the enum does not know about is dropped rather
   * than treated as something. The access scope reads the same context the same
   * way, which is what keeps "may you mark this" and "may you see this" from
   * disagreeing about who the caller is.
   */
  private actorRoles(): ReadonlySet<Role> {
    return toRoles(getRequestContext()?.roles);
  }

  private inSchool<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.transactions.runInUserAndTenantContext(requireUserId(), requireTenantId(), work);
  }
}

// ---------------------------------------------------------------------------
// Row to response.
// ---------------------------------------------------------------------------

function toAttendanceDto(record: Attendance): AttendanceDto {
  return {
    id: record.id,
    attendanceType: record.attendanceType,
    attendanceContext: record.attendanceContext,
    date: record.date,
    status: record.status,
    studentId: record.studentId,
    teacherId: record.teacherId,
    staffId: record.staffId,
    classId: record.classId,
    sessionId: record.sessionId,
    termId: record.termId,
    checkInTime: record.checkInTime === null ? null : record.checkInTime.toISOString(),
    checkOutTime: record.checkOutTime === null ? null : record.checkOutTime.toISOString(),
    remarks: record.remarks,
    markedBy: record.markedBy,
  };
}

function toCorrectionDto(row: AttendanceCorrection): AttendanceCorrectionDto {
  return {
    id: row.id,
    attendanceId: row.attendanceId,
    previousStatus: row.previousStatus,
    newStatus: row.newStatus,
    reason: row.reason,
    changedBy: row.changedBy,
    changedAt: row.changedAt.toISOString(),
  };
}
