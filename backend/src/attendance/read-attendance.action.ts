import type { EntityManager, SelectQueryBuilder } from 'typeorm';

import type { AccessScope } from '../common/actions/access-scope';
import { TenantScopedAction } from '../common/actions/tenant-scoped.action';
import type { Page, PageRequest } from '../common/pagination/pagination';
import { attendanceScope } from './attendance-access.scope';
import type { AttendanceStatus, AttendanceType } from './attendance.enums';
import { Attendance } from './entities/attendance.entity';

/** Narrowing a caller asked for, on top of the narrowing their roles impose. */
export interface AttendanceFilter {
  readonly classId?: string;
  readonly studentId?: string;
  readonly teacherId?: string;
  readonly staffId?: string;
  readonly attendanceType?: AttendanceType;
  readonly date?: string;
  readonly from?: string;
  readonly to?: string;
}

/**
 * Reading attendance, always through the section 95 scope.
 *
 * Every row that leaves this module leaves through here, which is what makes the
 * scope a boundary rather than a convention. A filter a caller supplies narrows
 * further and can never widen: it is ANDed onto a query that already carries the
 * tenant predicate and the scope.
 */
export class ReadAttendanceAction extends TenantScopedAction<Attendance> {
  constructor(manager: EntityManager) {
    super(manager, Attendance);
  }

  protected readonly accessScope: AccessScope<Attendance> = attendanceScope<Attendance>();

  /**
   * The query a list runs: the tenant predicate, the access scope, the caller's
   * filters, the order and the page.
   *
   * Returned as a builder rather than kept inside `list` so that the performance
   * gate can EXPLAIN exactly the statement that ships, rather than a
   * reconstruction of it that could drift from it and still pass.
   */
  listQuery(filter: AttendanceFilter, page: PageRequest): SelectQueryBuilder<Attendance> {
    return this.filtered(filter)
      .orderBy('attendance.date', 'DESC')
      .addOrderBy('attendance.id', 'ASC')
      .take(page.limit)
      .skip(page.offset);
  }

  /** One page of records, newest day first. */
  async list(filter: AttendanceFilter, page: PageRequest): Promise<Page<Attendance>> {
    const [items, total] = await this.listQuery(filter, page).getManyAndCount();

    return { items, total, limit: page.limit, offset: page.offset };
  }

  /**
   * One record, or null when it does not exist or this caller may not see it.
   *
   * The two are deliberately the same answer. Distinguishing them would tell a
   * parent that a record exists for a child who is not theirs.
   */
  async findVisible(id: string): Promise<Attendance | null> {
    return this.scopedQuery('attendance')
      .andWhere('attendance.id = :__attendanceId', { __attendanceId: id })
      .getOne();
  }

  /**
   * Changes a status and lets the database write the trail.
   *
   * The reason is set as a transaction-local setting rather than passed to an
   * insert, because the trigger is what writes the history row and the trigger
   * can only see the row and the session. `set_config(..., true)` is scoped to
   * the transaction the request already runs in, so it cannot leak onto the next
   * request through a pooled connection, and it is bound as a parameter so a
   * hostile reason stays data.
   *
   * It is cleared afterwards regardless of outcome. Without that, a second
   * correction later in the same request would inherit the first one's reason
   * and record something untrue.
   */
  async correct(record: Attendance, status: AttendanceStatus, reason: string): Promise<Attendance> {
    try {
      await this.manager.query(`SELECT set_config('app.attendance_reason', $1, true)`, [reason]);
      await this.manager.update(Attendance, { id: record.id, tenantId: this.tenantId }, { status });
    } finally {
      await this.manager.query(`SELECT set_config('app.attendance_reason', '', true)`);
    }

    return { ...record, status };
  }

  /**
   * The scoped query with the caller's own filters applied.
   *
   * Protected so that `ReportAttendanceAction` aggregates exactly this query:
   * there is one place a scoped attendance query is assembled, and a report
   * cannot count a row the record list would not return.
   */
  protected filtered(filter: AttendanceFilter): SelectQueryBuilder<Attendance> {
    const query = this.scopedQuery('attendance');

    for (const [property, value] of [
      ['classId', filter.classId],
      ['studentId', filter.studentId],
      ['teacherId', filter.teacherId],
      ['staffId', filter.staffId],
      ['attendanceType', filter.attendanceType],
    ] as const) {
      if (value !== undefined) {
        query.andWhere(`attendance.${property} = :__${property}`, { [`__${property}`]: value });
      }
    }

    if (filter.date !== undefined) {
      query.andWhere('attendance.date = :__onDate', { __onDate: filter.date });
    }

    if (filter.from !== undefined) {
      query.andWhere('attendance.date >= :__fromDate', { __fromDate: filter.from });
    }

    if (filter.to !== undefined) {
      query.andWhere('attendance.date <= :__toDate', { __toDate: filter.to });
    }

    return query;
  }
}
