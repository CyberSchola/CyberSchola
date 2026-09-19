import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  CorrectAttendanceDto,
  MarkClassAttendanceDto,
  MarkEmployeeAttendanceDto,
  MAX_ROSTER,
} from './attendance.dto';

/** Every constraint message a body produces, flattened, including nested ones. */
function messages<T extends object>(type: new () => T, body: object): string[] {
  const flatten = (errors: ReturnType<typeof validateSync>): string[] =>
    errors.flatMap((error) => [
      ...Object.values(error.constraints ?? {}),
      ...flatten(error.children ?? []),
    ]);

  return flatten(validateSync(plainToInstance(type, body)));
}

const ROSTER = [{ studentId: '11111111-1111-4111-8111-111111111111', status: 'PRESENT' }];

describe('taking a register', () => {
  it('accepts a date and a roster', () => {
    expect(messages(MarkClassAttendanceDto, { date: '2026-09-17', entries: ROSTER })).toEqual([]);
  });

  it.each([
    ['a timestamp rather than a date', '2026-09-17T08:00:00Z'],
    ['a date with no padding', '2026-9-7'],
    ['words', 'today'],
    ['nothing', undefined],
  ])('refuses %s', (_label, date) => {
    expect(messages(MarkClassAttendanceDto, { date, entries: ROSTER })).toContain(
      'date must be a calendar date in YYYY-MM-DD form',
    );
  });

  it('refuses an empty roster, because a register of nobody records nothing', () => {
    expect(messages(MarkClassAttendanceDto, { date: '2026-09-17', entries: [] })).toContain(
      'entries must name at least one student',
    );
  });

  it('refuses a roster larger than a class', () => {
    const entries = Array.from({ length: MAX_ROSTER + 1 }, () => ROSTER[0]);

    expect(messages(MarkClassAttendanceDto, { date: '2026-09-17', entries })).toContain(
      `entries must hold at most ${MAX_ROSTER} students`,
    );
  });

  it('validates each line of the roster, not just the list', () => {
    // The nested check is what makes a factory-built route unsafe: without the
    // body's class at runtime, this is exactly what stops being enforced.
    const failures = messages(MarkClassAttendanceDto, {
      date: '2026-09-17',
      entries: [{ studentId: 'not-a-uuid', status: 'PRESENT' }],
    });

    expect(failures).toContain('studentId must be a uuid');
  });

  it('refuses a status that is not one of the attendance statuses', () => {
    const failures = messages(MarkClassAttendanceDto, {
      date: '2026-09-17',
      entries: [{ studentId: ROSTER[0].studentId, status: 'HERE' }],
    });

    expect(failures).toHaveLength(1);
  });
});

describe("recording an employee's day", () => {
  it('accepts arrival and departure times', () => {
    expect(
      messages(MarkEmployeeAttendanceDto, {
        date: '2026-09-17',
        status: 'PRESENT',
        checkInTime: '2026-09-17T07:45:00.000Z',
        checkOutTime: '2026-09-17T15:10:00.000Z',
      }),
    ).toEqual([]);
  });

  it('refuses a time that is not a timestamp', () => {
    expect(
      messages(MarkEmployeeAttendanceDto, {
        date: '2026-09-17',
        status: 'PRESENT',
        checkInTime: 'quarter to eight',
      }),
    ).toContain('checkInTime must be an ISO 8601 timestamp');
  });
});

describe('correcting a record', () => {
  it('accepts a status and a reason', () => {
    expect(
      messages(CorrectAttendanceDto, { status: 'PRESENT', reason: 'Marked absent in error.' }),
    ).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['empty', ''],
  ])('refuses a %s reason, because the trail is the point', (_label, reason) => {
    expect(messages(CorrectAttendanceDto, { status: 'PRESENT', reason })).not.toHaveLength(0);
  });
});
