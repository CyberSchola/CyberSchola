import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/**
 * An academic year, such as 2026/2027.
 *
 * The migration is the source of truth for the schema, including the exclusion
 * constraint that stops sessions overlapping and the partial unique index that
 * allows one current session per school. `synchronize` is off; this entity
 * exists so actions can query through TypeORM.
 */
@Entity('academic_sessions')
export class AcademicSession extends TenantOwnedEntity {
  @Column({ type: 'citext' })
  name!: string;

  @Column({ type: 'date', name: 'starts_on' })
  startsOn!: string;

  @Column({ type: 'date', name: 'ends_on' })
  endsOn!: string;

  @Column({ type: 'boolean', name: 'is_current', default: false })
  isCurrent!: boolean;
}
