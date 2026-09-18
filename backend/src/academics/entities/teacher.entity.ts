import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/** A teacher, anchored on a membership. Thin for the same reason as Student. */
@Entity('teachers')
export class Teacher extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'membership_id' })
  membershipId!: string;
}
