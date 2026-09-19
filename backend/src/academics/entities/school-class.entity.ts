import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/**
 * A class: a grade level and an arm within one session, such as JSS 2 "A".
 *
 * Named `SchoolClass` rather than `Class` so it never collides with the
 * language keyword in a reader's head or an import.
 */
@Entity('classes')
export class SchoolClass extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'session_id' })
  sessionId!: string;

  @Column({ type: 'uuid', name: 'grade_level_id' })
  gradeLevelId!: string;

  @Column({ type: 'citext' })
  arm!: string;
}
