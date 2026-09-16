import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/**
 * A teacher of the school.
 *
 * Record first, login second, as with Student. A live row linked to a membership
 * is what gives that membership the TEACHER role, and assignments point here.
 */
@Entity('teachers')
export class Teacher extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'membership_id', nullable: true })
  membershipId!: string | null;

  @Column({ type: 'text', name: 'first_name' })
  firstName!: string;

  @Column({ type: 'text', name: 'last_name' })
  lastName!: string;
}
