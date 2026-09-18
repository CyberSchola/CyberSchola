import type { EntityManager, SelectQueryBuilder } from 'typeorm';

import { ValidationFailedException } from '../common/exceptions/app.exception';
import { AttendanceStatus, AttendanceType } from './attendance.enums';
import type { Attendance } from './entities/attendance.entity';
import { ReadAttendanceAction } from './read-attendance.action';
import {
  calendarRange,
  type DateRange,
  isCalendarPeriod,
  ReportGrouping,
  ReportPeriod,
} from './report-period';

/** One group's counts for a period. */
export interface ReportRow {
  readonly group: { readonly id: string | null; readonly label: string };
  readonly present: number;
  readonly absent: number;
  readonly late: number;
  readonly excused: number;
  readonly sick: number;
  readonly leave: number;
  readonly total: number;
  /** (PRESENT + LATE) / total: attended over recorded, every absence counts. */
  readonly rate: number;
}

/** A whole report: the period it resolved to, and a row per group. */
export interface AttendanceReport {
  readonly period: DateRange;
  readonly groupBy: ReportGrouping;
  readonly rows: readonly ReportRow[];
}

/** Why a named period cannot be reported. Shared with the route's documentation. */
export const NO_PERIOD_COVERS_DATE = (kind: string) =>
  `No ${kind.toLowerCase()} of this school covers that date, so there is no period to report.`;

/** The count columns, one per status, in the order the row reports them. */
const COUNTED: ReadonlyArray<readonly [keyof ReportRow, AttendanceStatus]> = [
  ['present', AttendanceStatus.Present],
  ['absent', AttendanceStatus.Absent],
  ['late', AttendanceStatus.Late],
  ['excused', AttendanceStatus.Excused],
  ['sick', AttendanceStatus.Sick],
  ['leave', AttendanceStatus.Leave],
];

interface RawRow {
  group_id: string | null;
  present: string;
  absent: string;
  late: string;
  excused: string;
  sick: string;
  leave: string;
  total: string;
}

/**
 * Attendance reports, blueprint section 97, over exactly the records a caller
 * may read.
 *
 * A subclass of `ReadAttendanceAction` on purpose. Every report starts from the
 * `filtered` query the record list uses, tenant predicate and section 95 scope
 * already applied, and only adds a date range, a grouping and the counts. So a
 * parent's monthly report counts their child and nothing else, a teacher's
 * counts their pupils and their own days, and there is no second place a scoped
 * attendance query is assembled for the two to drift apart. Review of BE-AT01
 * asked for exactly this property.
 *
 * Only what was recorded is reported. A class nobody took a register for has no
 * row, because zero present out of zero recorded and zero present out of thirty
 * absent are different facts and a zero row could not tell them apart.
 */
export class ReportAttendanceAction extends ReadAttendanceAction {
  constructor(manager: EntityManager) {
    super(manager);
  }

  /**
   * The inclusive date range a period covers, for a date.
   *
   * TERM and SESSION are found by date in any session, not only the current
   * one, so last term can still be reported. A date no term or session covers
   * is a 422, the same answer marking gives for a date in the holidays.
   */
  async resolvePeriod(kind: ReportPeriod, date: string): Promise<DateRange> {
    if (isCalendarPeriod(kind)) {
      try {
        return calendarRange(kind, date);
      } catch (error) {
        throw new ValidationFailedException([(error as Error).message]);
      }
    }

    const table = kind === ReportPeriod.Term ? 'terms' : 'academic_sessions';
    const [row] = await this.manager.query<Array<{ name: string; from: string; to: string }>>(
      `SELECT name, to_char(starts_on, 'YYYY-MM-DD') AS "from", to_char(ends_on, 'YYYY-MM-DD') AS "to"
         FROM ${table}
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND $2::date BETWEEN starts_on AND ends_on
        ORDER BY starts_on DESC
        LIMIT 1`,
      [this.tenantId, date],
    );

    if (row === undefined) {
      throw new ValidationFailedException([NO_PERIOD_COVERS_DATE(kind)]);
    }

    return { kind, from: row.from, to: row.to, label: row.name };
  }

  /**
   * One row per group with records in the range, ordered by label.
   *
   * Counted first, labelled second. Joining names onto every attendance row
   * before grouping made a whole-school session report by student take over
   * three seconds on a 2,000-pupil school, because the join ran for each of
   * roughly 300,000 rows; labelling the grouped result touches one row per
   * group. The labels are read for exactly the ids the scoped count returned,
   * so they can name nobody the caller could not already see.
   */
  async summarise(period: DateRange, groupBy: ReportGrouping): Promise<AttendanceReport> {
    const raw = await this.reportQuery(period, groupBy).getRawMany<RawRow>();
    const labels = await this.labelsFor(
      groupBy,
      raw.map((row) => row.group_id).filter((id): id is string => id !== null),
    );

    const rows = raw
      .map((row) => toRow(row, labels.get(row.group_id ?? '') ?? String(row.group_id)))
      .sort((left, right) => left.group.label.localeCompare(right.group.label));

    return { period, groupBy, rows };
  }

  /**
   * The aggregate a report runs.
   *
   * Exposed, like `listQuery`, so the performance gate can EXPLAIN the statement
   * that ships rather than a reconstruction of it.
   */
  reportQuery(period: DateRange, groupBy: ReportGrouping): SelectQueryBuilder<Attendance> {
    const query = this.filtered({ from: period.from, to: period.to });

    this.applyGrouping(query, groupBy);

    for (const [name, status] of COUNTED) {
      // The statuses are this module's own enum constants, never caller input.
      query.addSelect(`COUNT(*) FILTER (WHERE attendance.status = '${status}')`, name);
    }

    return query.addSelect('COUNT(*)', 'total');
  }

  /**
   * Selects the group id, restricts to the kind of person the group is made of,
   * and groups. No joins: the count reads attendance alone.
   */
  private applyGrouping(query: SelectQueryBuilder<Attendance>, groupBy: ReportGrouping): void {
    const byColumn = (column: string, type: AttendanceType) =>
      query
        .andWhere('attendance.attendanceType = :__reportType', { __reportType: type })
        .select(`attendance.${column}`, 'group_id')
        .groupBy(`attendance.${column}`);

    switch (groupBy) {
      case ReportGrouping.Class:
        byColumn('classId', AttendanceType.Student);
        return;

      case ReportGrouping.Student:
        byColumn('studentId', AttendanceType.Student);
        return;

      case ReportGrouping.Teacher:
        byColumn('teacherId', AttendanceType.Teacher);
        return;

      case ReportGrouping.Staff:
        byColumn('staffId', AttendanceType.Staff);
        return;

      case ReportGrouping.Role:
        query.select('attendance.attendanceType', 'group_id').groupBy('attendance.attendanceType');
        return;
    }
  }

  /**
   * A readable label for each group id.
   *
   * Removed classes and people are still named: a report is about what
   * happened in the period, and a class dissolved since then still ran then.
   * An id with no label at all falls back to the id itself in `summarise`.
   */
  private async labelsFor(
    groupBy: ReportGrouping,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (groupBy === ReportGrouping.Role) {
      return new Map(ids.map((id) => [id, id]));
    }

    if (ids.length === 0) {
      return new Map();
    }

    const sql =
      groupBy === ReportGrouping.Class
        ? `SELECT class.id, grade.name || ' ' || class.arm AS label
             FROM classes class
             JOIN grade_levels grade ON grade.id = class.grade_level_id
            WHERE class.tenant_id = $1 AND class.id = ANY($2::uuid[])`
        : `SELECT person.id, person.first_name || ' ' || person.last_name AS label
             FROM ${PERSON_TABLES[groupBy]} person
            WHERE person.tenant_id = $1 AND person.id = ANY($2::uuid[])`;

    const rows = await this.manager.query<Array<{ id: string; label: string }>>(sql, [
      this.tenantId,
      [...ids],
    ]);

    return new Map(rows.map((row) => [row.id, row.label]));
  }
}

/** Where each kind of person's name lives. */
const PERSON_TABLES: Readonly<
  Record<ReportGrouping.Student | ReportGrouping.Teacher | ReportGrouping.Staff, string>
> = {
  [ReportGrouping.Student]: 'students',
  [ReportGrouping.Teacher]: 'teachers',
  [ReportGrouping.Staff]: 'staff',
};

function toRow(raw: RawRow, label: string): ReportRow {
  const counts = Object.fromEntries(
    COUNTED.map(([name]) => [name, Number(raw[name as keyof RawRow])]),
  );
  const total = Number(raw.total);
  const attended = (counts.present ?? 0) + (counts.late ?? 0);

  return {
    group: { id: raw.group_id, label },
    present: counts.present ?? 0,
    absent: counts.absent ?? 0,
    late: counts.late ?? 0,
    excused: counts.excused ?? 0,
    sick: counts.sick ?? 0,
    leave: counts.leave ?? 0,
    total,
    // Four places, enough for a percentage to one decimal and no false precision.
    rate: total === 0 ? 0 : Math.round((attended / total) * 10_000) / 10_000,
  };
}
