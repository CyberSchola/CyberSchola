import type { CacheService } from '../redis/cache.service';
import {
  AttendanceReportCache,
  GENERATION_TTL_SECONDS,
  REPORT_TTL_SECONDS,
  reportKey,
} from './attendance-report-cache';
import type { AttendanceReport } from './report-attendance.action';
import { ReportGrouping, ReportPeriod } from './report-period';

const SCHOOL = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const WEEK = { kind: ReportPeriod.Weekly, from: '2026-09-14', to: '2026-09-20' };
const REPORT: AttendanceReport = { period: WEEK, groupBy: ReportGrouping.Class, rows: [] };

/** A cache whose every call fails, as Redis does when it is unreachable. */
function unreachable(): CacheService {
  const down = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:6379'));

  return { get: down, set: down, increment: down } as unknown as CacheService;
}

describe('the attendance report cache', () => {
  describe('when Redis is unreachable', () => {
    const cache = new AttendanceReportCache(unreachable());

    beforeEach(() => {
      // Each method logs its degradation; the tests check behaviour, not output.
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => jest.restoreAllMocks());

    it('reports no generation, which means "do not cache", rather than guessing one', async () => {
      // Guessing 0 could read or write a report under the wrong generation.
      await expect(cache.generation(SCHOOL)).resolves.toBeNull();
    });

    it('treats an unreadable report as a miss, so the report is computed from Postgres', async () => {
      await expect(cache.read(SCHOOL, 3, WEEK, ReportGrouping.Class)).resolves.toBeNull();
    });

    it('does not fail a report because it could not be stored', async () => {
      await expect(cache.store(SCHOOL, 3, REPORT)).resolves.toBeUndefined();
    });

    it('does not fail a write that has already committed', async () => {
      // Throwing here would tell a teacher their register failed when it saved,
      // and their retry would meet a 409 for their own register.
      await expect(cache.invalidate(SCHOOL)).resolves.toBeUndefined();
    });
  });

  it('keys a report by generation, resolved range and grouping', () => {
    expect(reportKey(8, WEEK, ReportGrouping.Class)).toEqual([
      'attendance',
      'report',
      'g8',
      'WEEKLY',
      '2026-09-14',
      '2026-09-20',
      'class',
    ]);
  });

  it('keeps a term and a month over the same dates apart', () => {
    const month = { kind: ReportPeriod.Monthly, from: '2026-09-01', to: '2026-09-30' };
    const term = { kind: ReportPeriod.Term, from: '2026-09-01', to: '2026-09-30' };

    expect(reportKey(1, month, ReportGrouping.Role)).not.toEqual(
      reportKey(1, term, ReportGrouping.Role),
    );
  });

  it('lets the generation outlive every report built from it', () => {
    // When a counter lapses it restarts from 1. That is only safe if no report
    // cached under an old 1 can still exist, so the counter must live longer.
    expect(GENERATION_TTL_SECONDS).toBeGreaterThan(REPORT_TTL_SECONDS * 10);
  });
});
