import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/**
 * A school administrator.
 *
 * Unlike every other person type, always linked to a membership: an
 * administrator without a login cannot administer anything, so the record has
 * no meaning on its own. A live row is what gives the membership SCHOOL_ADMIN.
 */
@Entity('school_admins')
export class SchoolAdmin extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'membership_id' })
  membershipId!: string;
}
