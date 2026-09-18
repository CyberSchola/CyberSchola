import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/** A subject the school teaches. Not tied to a session. */
@Entity('subjects')
export class Subject extends TenantOwnedEntity {
  @Column({ type: 'citext' })
  name!: string;

  @Column({ type: 'citext', nullable: true })
  code!: string | null;
}
