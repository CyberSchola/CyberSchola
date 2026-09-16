import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/**
 * A student, anchored on a membership.
 *
 * Thin on purpose. The people phase adds names, guardians and a date of birth as
 * columns here, and because enrolments already point at this table, no foreign
 * key moves when it does.
 */
@Entity('students')
export class Student extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'membership_id' })
  membershipId!: string;
}
