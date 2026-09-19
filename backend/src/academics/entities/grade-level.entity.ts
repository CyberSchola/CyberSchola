import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/** A grade level such as JSS 1 or Primary 4, ordered by `position` for promotion. */
@Entity('grade_levels')
export class GradeLevel extends TenantOwnedEntity {
  @Column({ type: 'citext' })
  name!: string;

  @Column({ type: 'integer' })
  position!: number;
}
