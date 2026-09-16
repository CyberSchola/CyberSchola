import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/** How a parent is related to a child. */
export enum GuardianRelationship {
  Mother = 'MOTHER',
  Father = 'FATHER',
  Guardian = 'GUARDIAN',
  Other = 'OTHER',
}

/**
 * A parent's link to a child.
 *
 * This row is the whole of blueprint section 17: a parent may see a student only
 * through a live guardianship. Removing it removes that access on the next
 * request, because nothing about it is cached.
 */
@Entity('guardianships')
export class Guardianship extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'parent_id' })
  parentId!: string;

  @Column({ type: 'uuid', name: 'student_id' })
  studentId!: string;

  @Column({
    type: 'enum',
    enum: GuardianRelationship,
    enumName: 'guardianships_relationship_enum',
    default: GuardianRelationship.Guardian,
  })
  relationship!: GuardianRelationship;
}
