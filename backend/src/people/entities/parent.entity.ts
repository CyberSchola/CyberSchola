import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/**
 * A parent or guardian.
 *
 * Which children they may see is not stored here: it is the guardianships that
 * point at this row. A parent with no guardianship sees nobody.
 */
@Entity('parents')
export class Parent extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'membership_id', nullable: true })
  membershipId!: string | null;

  @Column({ type: 'text', name: 'first_name' })
  firstName!: string;

  @Column({ type: 'text', name: 'last_name' })
  lastName!: string;

  @Column({ type: 'citext', nullable: true })
  email!: string | null;

  @Column({ type: 'text', nullable: true })
  phone!: string | null;
}
