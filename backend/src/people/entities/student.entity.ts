import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/**
 * A student of the school.
 *
 * A record first and a login second. `membershipId` is null until an
 * administrator links the student's account, and many students never have one.
 * Holding a live row here with a membership is what gives that membership the
 * STUDENT role.
 *
 * Everything below the names is personal data, and the API decides per caller
 * whether to return it: see the summary and profile shapes in the people module.
 */
@Entity('students')
export class Student extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'membership_id', nullable: true })
  membershipId!: string | null;

  @Column({ type: 'text', name: 'first_name' })
  firstName!: string;

  @Column({ type: 'text', name: 'last_name' })
  lastName!: string;

  @Column({ type: 'text', name: 'other_names', nullable: true })
  otherNames!: string | null;

  /** A calendar date, kept as the `YYYY-MM-DD` string Postgres returns. */
  @Column({ type: 'date', name: 'date_of_birth', nullable: true })
  dateOfBirth!: string | null;

  @Column({ type: 'citext', name: 'admission_number', nullable: true })
  admissionNumber!: string | null;
}
