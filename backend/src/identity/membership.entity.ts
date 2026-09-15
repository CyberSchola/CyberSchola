import { Column, Entity, Index } from 'typeorm';

import { Role } from '../auth/permission.matrix';
import { TenantOwnedEntity } from '../common/entities/tenant-owned.entity';

/** Whether a membership is currently usable. */
export enum MembershipStatus {
  Active = 'ACTIVE',
  Suspended = 'SUSPENDED',
}

/**
 * Who belongs to a school, and as what.
 *
 * Maps the table created in migration 1757500000000. The migration remains the
 * source of truth for the schema, including the two partial indexes and the
 * policy, because `synchronize` is off and always will be: this entity exists
 * so actions can query through TypeORM, not so TypeORM can build the table.
 *
 * `userId` is the Supabase subject and carries no foreign key, because the auth
 * schema belongs to Supabase rather than to us.
 */
@Entity('memberships')
export class Membership extends TenantOwnedEntity {
  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'enum', enum: Role, enumName: 'memberships_role_enum' })
  role!: Role;

  @Column({
    type: 'enum',
    enum: MembershipStatus,
    enumName: 'memberships_status_enum',
    default: MembershipStatus.Active,
  })
  status!: MembershipStatus;
}
