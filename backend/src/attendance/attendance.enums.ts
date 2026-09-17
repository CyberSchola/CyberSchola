/**
 * Who an attendance record is about.
 *
 * Blueprint section 90. The record carries one of these and exactly one subject
 * id to match, which migration 1757800000000 enforces with a check constraint.
 */
export enum AttendanceType {
  Student = 'STUDENT',
  Teacher = 'TEACHER',
  Staff = 'STAFF',
}

/**
 * What kind of attendance a record is.
 *
 * Section 94 names subject and live-class attendance as where this is going, and
 * their uniqueness rule is different from a school day's: one record per subject
 * per day rather than one per day. The values exist in the database type so that
 * supporting one later is a rule change rather than an alteration of a populated
 * column, and only `SCHOOL_DAY` is accepted today.
 */
export enum AttendanceContext {
  SchoolDay = 'SCHOOL_DAY',
  SubjectClass = 'SUBJECT_CLASS',
  LiveClass = 'LIVE_CLASS',
}

/** The contexts the application accepts today. See the check constraint. */
export const SUPPORTED_CONTEXTS: readonly AttendanceContext[] = [AttendanceContext.SchoolDay];

/**
 * How a person's day is recorded.
 *
 * Section 91 asks for more than present and absent, and points out that not
 * every status applies to every kind of person.
 */
export enum AttendanceStatus {
  Present = 'PRESENT',
  Absent = 'ABSENT',
  Late = 'LATE',
  Excused = 'EXCUSED',
  Sick = 'SICK',
  Leave = 'LEAVE',
}

/**
 * Which statuses each kind of person may be given.
 *
 * Section 91: `LEAVE` is an employment arrangement, so it belongs to teachers
 * and staff. A child who is away with the school's agreement is `EXCUSED`, and
 * one who is unwell is `SICK`.
 *
 * This map is the readable declaration. It is not the enforcement: the check
 * constraint in the migration is, so a status this map would refuse cannot be
 * stored by anything, including a job or a hand-written statement. The map gives
 * the API a 422 with a useful message before the database has to.
 */
export const STATUSES_BY_TYPE: Readonly<Record<AttendanceType, readonly AttendanceStatus[]>> =
  Object.freeze({
    [AttendanceType.Student]: [
      AttendanceStatus.Present,
      AttendanceStatus.Absent,
      AttendanceStatus.Late,
      AttendanceStatus.Excused,
      AttendanceStatus.Sick,
    ],
    [AttendanceType.Teacher]: Object.values(AttendanceStatus),
    [AttendanceType.Staff]: Object.values(AttendanceStatus),
  });

/** Whether a kind of person may be given a status. */
export function statusAllowedForType(type: AttendanceType, status: AttendanceStatus): boolean {
  return STATUSES_BY_TYPE[type].includes(status);
}

/** Every status the application defines, for the enum parity test and Swagger. */
export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = Object.values(AttendanceStatus);

/** Every subject kind the application defines. */
export const ATTENDANCE_TYPES: readonly AttendanceType[] = Object.values(AttendanceType);

/** Every context the database type knows about, supported or not yet. */
export const ATTENDANCE_CONTEXTS: readonly AttendanceContext[] = Object.values(AttendanceContext);
