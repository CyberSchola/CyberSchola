import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/**
 * A period of the school week in one session, such as Tuesday P3, 09:20 to 10:00.
 *
 * The database keeps periods on one weekday from overlapping, and a label unique
 * per weekday, so "Tuesday P3" always names one period.
 */
@Entity('timetable_periods')
export class TimetablePeriod extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'session_id' })
  sessionId!: string;

  /** ISO weekday: Monday is 1, Sunday is 7. */
  @Column({ type: 'smallint' })
  weekday!: number;

  @Column({ type: 'citext' })
  label!: string;

  /** `HH:MM:SS`, as Postgres returns a `time`. */
  @Column({ type: 'time', name: 'starts_at' })
  startsAt!: string;

  @Column({ type: 'time', name: 'ends_at' })
  endsAt!: string;
}
