import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/**
 * A non-teaching member of staff.
 *
 * Blueprint section 18 keeps staff access limited to themselves for now, so the
 * record is small. Specialised staff roles extend it later.
 */
@Entity('staff')
export class Staff extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'membership_id', nullable: true })
  membershipId!: string | null;

  @Column({ type: 'text', name: 'first_name' })
  firstName!: string;

  @Column({ type: 'text', name: 'last_name' })
  lastName!: string;

  @Column({ type: 'text', name: 'job_title', nullable: true })
  jobTitle!: string | null;
}
