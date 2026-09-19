import type { EntityManager } from 'typeorm';

import { ValidationFailedException } from '../common/exceptions/app.exception';
import { ReportAttendanceAction } from './report-attendance.action';
import { ReportPeriod } from './report-period';

describe('resolving a report period', () => {
  // TERM and SESSION are found with `$2::date BETWEEN starts_on AND ends_on`. A
  // date that does not exist must be refused before that statement is sent, so
  // the manager here records whether it was ever asked anything.
  it.each(Object.values(ReportPeriod))(
    'refuses a %s date that is not on the calendar without asking Postgres',
    async (kind) => {
      const query = jest.fn();
      const action = new ReportAttendanceAction({ query } as unknown as EntityManager);

      await expect(action.resolvePeriod(kind, '2026-02-30')).rejects.toEqual(
        new ValidationFailedException(['2026-02-30 is not a real calendar date.']),
      );
      expect(query).not.toHaveBeenCalled();
    },
  );
});
