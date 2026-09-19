import { assertCalendarDate, calendarRange, isCalendarPeriod, ReportPeriod } from './report-period';

/**
 * The calendar periods at the dates where period arithmetic goes wrong.
 *
 * TERM and SESSION are read from the database and are tested there; these three
 * are pure, so their edges are pinned here where a failure is fast and exact.
 */
describe('calendar periods', () => {
  describe('WEEKLY is the Monday to Sunday week containing the date', () => {
    it.each([
      ['a Monday', '2026-09-14', '2026-09-14', '2026-09-20'],
      ['a Thursday', '2026-09-17', '2026-09-14', '2026-09-20'],
      [
        'a Sunday, which ends the week rather than starting one',
        '2026-09-20',
        '2026-09-14',
        '2026-09-20',
      ],
      ['a week that crosses a month end', '2026-10-01', '2026-09-28', '2026-10-04'],
      ['a week that crosses a year end', '2027-01-01', '2026-12-28', '2027-01-03'],
    ])('for %s', (_label, date, from, to) => {
      expect(calendarRange(ReportPeriod.Weekly, date)).toEqual({
        kind: ReportPeriod.Weekly,
        from,
        to,
      });
    });
  });

  describe('MONTHLY is the calendar month', () => {
    it.each([
      ['a thirty-day month', '2026-09-17', '2026-09-01', '2026-09-30'],
      ['a thirty-one-day month, on its last day', '2026-10-31', '2026-10-01', '2026-10-31'],
      ['February in an ordinary year', '2027-02-10', '2027-02-01', '2027-02-28'],
      ['February in a leap year', '2028-02-10', '2028-02-01', '2028-02-29'],
      ['December, whose next month is in another year', '2026-12-05', '2026-12-01', '2026-12-31'],
    ])('for %s', (_label, date, from, to) => {
      expect(calendarRange(ReportPeriod.Monthly, date)).toEqual({
        kind: ReportPeriod.Monthly,
        from,
        to,
      });
    });
  });

  it('makes DAILY the day itself', () => {
    expect(calendarRange(ReportPeriod.Daily, '2026-09-17')).toEqual({
      kind: ReportPeriod.Daily,
      from: '2026-09-17',
      to: '2026-09-17',
    });
  });

  it.each(['2026-02-30', '2027-02-29', '2026-13-01'])(
    'refuses %s, rather than reporting on a period nobody asked for',
    (date) => {
      // The DTO accepts the shape YYYY-MM-DD, which these match. Without this
      // check, 2026-02-30 would quietly roll into March.
      expect(() => calendarRange(ReportPeriod.Monthly, date)).toThrow(/not a real calendar date/);
    },
  );

  describe('assertCalendarDate, the check every period shares', () => {
    it.each(['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-04-31'])(
      'refuses %s',
      (date) => {
        expect(() => assertCalendarDate(date)).toThrow(`${date} is not a real calendar date.`);
      },
    );

    it.each(['2028-02-29', '2026-12-31', '2026-01-01'])('accepts %s', (date) => {
      expect(() => assertCalendarDate(date)).not.toThrow();
    });
  });

  it('knows which periods are calendar arithmetic and which the school defines', () => {
    expect(
      [ReportPeriod.Daily, ReportPeriod.Weekly, ReportPeriod.Monthly].every(isCalendarPeriod),
    ).toBe(true);
    expect(isCalendarPeriod(ReportPeriod.Term)).toBe(false);
    expect(isCalendarPeriod(ReportPeriod.Session)).toBe(false);
  });
});
