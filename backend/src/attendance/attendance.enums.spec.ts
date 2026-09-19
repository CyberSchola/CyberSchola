import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_TYPES,
  AttendanceStatus,
  AttendanceType,
  STATUSES_BY_TYPE,
  statusAllowedForType,
} from './attendance.enums';

/**
 * Blueprint section 91: not every status applies to every kind of person.
 *
 * Asserted cell by cell rather than sampled, like the permission matrix, so that
 * widening what a student may be given cannot land without editing an assertion
 * here. The database's check constraint is the enforcement; this is the readable
 * statement of the rule and the fast feedback on it.
 */
describe('which statuses each kind of person may hold', () => {
  const EXPECTED: Readonly<Record<AttendanceType, readonly AttendanceStatus[]>> = {
    [AttendanceType.Student]: [
      AttendanceStatus.Present,
      AttendanceStatus.Absent,
      AttendanceStatus.Late,
      AttendanceStatus.Excused,
      AttendanceStatus.Sick,
    ],
    [AttendanceType.Teacher]: [
      AttendanceStatus.Present,
      AttendanceStatus.Absent,
      AttendanceStatus.Late,
      AttendanceStatus.Excused,
      AttendanceStatus.Sick,
      AttendanceStatus.Leave,
    ],
    [AttendanceType.Staff]: [
      AttendanceStatus.Present,
      AttendanceStatus.Absent,
      AttendanceStatus.Late,
      AttendanceStatus.Excused,
      AttendanceStatus.Sick,
      AttendanceStatus.Leave,
    ],
  };

  describe.each(ATTENDANCE_TYPES)('%s', (type) => {
    it.each(ATTENDANCE_STATUSES)('%s', (status) => {
      expect(statusAllowedForType(type, status)).toBe(EXPECTED[type].includes(status));
    });
  });

  it('covers every kind, so a new one cannot slip past this suite', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ATTENDANCE_TYPES].sort());
  });

  it('gives LEAVE to employees and not to children, which is the whole distinction', () => {
    expect(statusAllowedForType(AttendanceType.Student, AttendanceStatus.Leave)).toBe(false);
    expect(statusAllowedForType(AttendanceType.Teacher, AttendanceStatus.Leave)).toBe(true);
    expect(statusAllowedForType(AttendanceType.Staff, AttendanceStatus.Leave)).toBe(true);
  });

  it('cannot be widened at runtime', () => {
    // Frozen because this is a policy table, and a module that mutated it would
    // change what the API accepts with nothing in any diff to review.
    expect(Object.isFrozen(STATUSES_BY_TYPE)).toBe(true);
  });
});
