import { Injectable, Logger } from '@nestjs/common';

import { tenantScope } from '../redis/cache-key';
import { CacheService } from '../redis/cache.service';
import type { AttendanceReport } from './report-attendance.action';
import type { DateRange, ReportGrouping } from './report-period';

/**
 * How long a cached report lives.
 *
 * Correctness does not come from this number. It comes from the generation: a
 * write moves the school to a new generation, and a report cached under the old
 * one is never looked up again. The TTL only decides how long those dead entries
 * sit in a Redis that runs noeviction, and bounds how stale an administrator's
 * view can get in the one case the generation cannot cover, a write whose bump
 * failed because Redis was unreachable at that moment.
 */
export const REPORT_TTL_SECONDS = 300;

/**
 * How long a school's generation counter lives after its last write.
 *
 * It has to outlive every report built from it, so that when it lapses and a
 * later write restarts it from 1, no report cached under a reused number can
 * still exist. A day against five minutes leaves that margin many times over,
 * and a day is the most the cache service allows anything to live.
 */
export const GENERATION_TTL_SECONDS = 86_400;

/**
 * The Redis side of attendance reports, blueprint section 98.
 *
 * ## What is cached
 *
 * Only a report that is the same for everyone who may see it: one computed by
 * an actor the attendance scope does not narrow, which today means an
 * administrator reading the whole school. A narrowed report, a teacher's or a
 * parent's, is never written to Redis at all. That is what makes the cache safe
 * inside a school as well as between schools: no key can ever hold an answer
 * that belongs to one caller. It also sidesteps the harder problem a per-user key
 * would have, which is that a teacher's scope changes with supervision and
 * subject assignments that no attendance write ever announces.
 *
 * ## How it is invalidated
 *
 * Each school has a generation number, and every report key contains it. A
 * write bumps the generation once, after it commits. A reader reads the
 * generation first and Postgres second, so a reader that raced a write and
 * computed from the rows before it can only ever store that answer under the
 * generation the write retired, where nobody will look. Deleting keys instead
 * leaves exactly that race open: the slow reader writes its stale answer back
 * after the delete.
 *
 * ## When Redis is down
 *
 * Redis is an optimisation, never the source of truth, so every method here
 * degrades instead of failing. A report that cannot reach Redis is computed from
 * Postgres and returned; a write whose bump fails is still reported as the
 * success it was, and the failure is logged loudly, because until the TTL runs
 * out an administrator may see the summary from before it.
 */
@Injectable()
export class AttendanceReportCache {
  private readonly logger = new Logger(AttendanceReportCache.name);

  constructor(private readonly cache: CacheService) {}

  /**
   * The school's current generation, or null when Redis cannot be read.
   *
   * Null means "do not use the cache for this request", not zero: guessing a
   * generation could read or write under the wrong one.
   */
  async generation(tenantId: string): Promise<number | null> {
    try {
      return (await this.cache.get<number>(tenantScope(tenantId), 'attendance', 'generation')) ?? 0;
    } catch (error) {
      this.logger.warn(`Attendance reports uncached: generation unreadable (${describe(error)})`);
      return null;
    }
  }

  /** A cached report, or null on a miss or when Redis cannot be read. */
  async read(
    tenantId: string,
    generation: number,
    period: DateRange,
    groupBy: ReportGrouping,
  ): Promise<AttendanceReport | null> {
    try {
      return await this.cache.get<AttendanceReport>(
        tenantScope(tenantId),
        ...reportKey(generation, period, groupBy),
      );
    } catch (error) {
      this.logger.warn(`Attendance report cache unreadable (${describe(error)})`);
      return null;
    }
  }

  /** Stores a report under the generation that was current before it was computed. */
  async store(tenantId: string, generation: number, report: AttendanceReport): Promise<void> {
    try {
      await this.cache.set(
        tenantScope(tenantId),
        REPORT_TTL_SECONDS,
        report,
        ...reportKey(generation, report.period, report.groupBy),
      );
    } catch (error) {
      this.logger.warn(`Attendance report not cached (${describe(error)})`);
    }
  }

  /**
   * Moves the school to a new generation. Called once a write has committed.
   *
   * Never throws. The write it follows has already succeeded, and telling the
   * client otherwise would make them retry a register that saved, into a 409.
   */
  async invalidate(tenantId: string): Promise<void> {
    try {
      await this.cache.increment(
        tenantScope(tenantId),
        GENERATION_TTL_SECONDS,
        'attendance',
        'generation',
      );
    } catch (error) {
      this.logger.error(
        `Attendance write committed but its report cache was not invalidated for school ` +
          `${tenantId}. Administrators may see the previous summary for up to ` +
          `${REPORT_TTL_SECONDS}s. (${describe(error)})`,
      );
    }
  }
}

/**
 * The key parts for one report.
 *
 * The resolved range rather than the requested date, so every date in a week
 * shares one entry. The kind is kept beside it because a term and a month can
 * cover the same dates and still be different reports to the person asking.
 */
export function reportKey(generation: number, period: DateRange, groupBy: ReportGrouping) {
  return ['attendance', 'report', `g${generation}`, period.kind, period.from, period.to, groupBy];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
