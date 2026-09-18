import type { EntityManager, SelectQueryBuilder } from 'typeorm';

import type { AccessScope } from '../common/actions/access-scope';
import { TenantScopedAction } from '../common/actions/tenant-scoped.action';
import { attendanceScope } from './attendance-access.scope';
import { AttendanceCorrection } from './entities/attendance-correction.entity';
import { Attendance } from './entities/attendance.entity';

/** The alias the corrected record is joined under. Prefixed so it cannot collide. */
const RECORD = '__correctedRecord';

/**
 * Who may read a correction: exactly who may read the record it corrects.
 *
 * The trail holds some of the most sensitive attendance data there is: what a
 * status used to be, what it became, who changed it and why. Its visibility is
 * not a new rule, it is the record's rule, so this scope does not restate it. It
 * joins each correction to its record and applies the attendance scope to that
 * record, which means a change to who may see attendance is a change to who may
 * see its history, with nothing to keep in step.
 *
 * Declared restricted, so the find-options read path is refused for corrections
 * the same way it is for any scoped entity: a `find` cannot carry the join, and
 * silently returning unscoped history would be the failure this exists to stop.
 */
function correctionScope(): AccessScope<AttendanceCorrection> {
  const records = attendanceScope<Attendance>();

  return {
    unrestricted: false,
    restrict(query, alias, actor) {
      query.innerJoin(
        Attendance,
        RECORD,
        `${RECORD}.id = ${alias}.attendanceId AND ${RECORD}.tenantId = ${alias}.tenantId`,
      );

      // The same builder, now carrying the record under its own alias. The
      // attendance scope only ever adds predicates on that alias.
      records.restrict(query as unknown as SelectQueryBuilder<Attendance>, RECORD, actor);
    },
  };
}

/**
 * Reading the correction trail, and the only way to.
 *
 * Review of BE-AT01 asked that the rule "you may read a correction only if you
 * may read its record" live in a reusable primitive rather than in the order a
 * service happens to call things. This is that primitive. Nothing else in `src`
 * may query the trail: an ESLint rule refuses a value import of the entity
 * outside this file, the entity and the module, and
 * `attendance-correction-boundary.spec.ts` checks the same thing, plus raw SQL
 * against the table, independently of lint configuration.
 */
export class ReadAttendanceCorrectionsAction extends TenantScopedAction<AttendanceCorrection> {
  constructor(manager: EntityManager) {
    super(manager, AttendanceCorrection);
  }

  protected readonly accessScope: AccessScope<AttendanceCorrection> = correctionScope();

  /**
   * The changes made to one record, newest first.
   *
   * Empty both when there are none and when the caller may not see the record.
   * The endpoint answers 404 for a record the caller may not see before it gets
   * here; this answer is what makes that 404 a convenience rather than the only
   * thing between a caller and someone else's history.
   */
  async forRecord(attendanceId: string): Promise<AttendanceCorrection[]> {
    return this.scopedQuery('correction')
      .andWhere('correction.attendanceId = :__correctedId', { __correctedId: attendanceId })
      .orderBy('correction.changedAt', 'DESC')
      .addOrderBy('correction.id', 'ASC')
      .getMany();
  }
}
