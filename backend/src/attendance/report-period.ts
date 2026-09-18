/**
 * The periods blueprint section 97 reports over.
 *
 * DAILY, WEEKLY and MONTHLY are calendar arithmetic and are resolved here, as a
 * pure function, so their edges can be tested without a database. TERM and
 * SESSION are whatever the school says they are, so they are read from the
 * `terms` and `academic_sessions` tables by `ReportAttendanceAction`.
 */
export enum ReportPeriod {
  Daily = 'DAILY',
  Weekly = 'WEEKLY',
  Monthly = 'MONTHLY',
  Term = 'TERM',
  Session = 'SESSION',
}

/** What a report's rows are grouped by. Section 97, less Department, which is future. */
export enum ReportGrouping {
  Class = 'class',
  Student = 'student',
  Teacher = 'teacher',
  Staff = 'staff',
  /** STUDENT, TEACHER and STAFF: the attendance type, which is what a role means here. */
  Role = 'role',
}

/** A resolved period: inclusive calendar dates, returned to the caller as they were used. */
export interface DateRange {
  readonly kind: ReportPeriod;
  readonly from: string;
  readonly to: string;
  /** The term or session name, for the two periods a school names. */
  readonly label?: string;
}

/** The calendar periods, which need no database to resolve. */
export type CalendarPeriod = ReportPeriod.Daily | ReportPeriod.Weekly | ReportPeriod.Monthly;

export function isCalendarPeriod(kind: ReportPeriod): kind is CalendarPeriod {
  return (
    kind === ReportPeriod.Daily || kind === ReportPeriod.Weekly || kind === ReportPeriod.Monthly
  );
}

/**
 * The calendar range containing a date.
 *
 * - DAILY is the day itself.
 * - WEEKLY is the ISO week: Monday to Sunday. A Sunday belongs to the week that
 *   began the Monday before it, and a week can span a month or a year end.
 * - MONTHLY is the calendar month, so February has 28 or 29 days as the year
 *   says.
 *
 * Arithmetic is done in UTC on a date with no time, so the answer cannot shift
 * with the server's timezone or a daylight-saving change.
 *
 * @param date A calendar date, `YYYY-MM-DD`. The DTO has already refused anything else.
 */
export function calendarRange(kind: CalendarPeriod, date: string): DateRange {
  const day = parseDate(date);

  switch (kind) {
    case ReportPeriod.Daily:
      return { kind, from: date, to: date };

    case ReportPeriod.Weekly: {
      // getUTCDay: Sunday is 0. Days since Monday: Monday 0 ... Sunday 6.
      const sinceMonday = (day.getUTCDay() + 6) % 7;
      const monday = addDays(day, -sinceMonday);

      return { kind, from: formatDate(monday), to: formatDate(addDays(monday, 6)) };
    }

    case ReportPeriod.Monthly: {
      const first = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
      // Day 0 of the next month is the last day of this one.
      const last = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0));

      return { kind, from: formatDate(first), to: formatDate(last) };
    }
  }
}

/**
 * Refuses a date that has the right shape but is not on the calendar.
 *
 * The one check every report period shares, run before a period is resolved at
 * all. The DTO checks the `YYYY-MM-DD` shape, which 2026-02-30 passes. The
 * calendar periods would catch it in `calendarRange`, but TERM and SESSION hand
 * the date to Postgres, which refuses it with an error the API would have
 * reported as a 500. Checking here, once, gives all five the same 422.
 *
 * @throws RangeError naming the date.
 */
export function assertCalendarDate(date: string): void {
  parseDate(date);
}

function parseDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  // 2026-02-30 would silently roll into March. Refuse it instead of reporting
  // on a period the caller did not ask for.
  if (formatDate(parsed) !== date) {
    throw new RangeError(`${date} is not a real calendar date.`);
  }

  return parsed;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
