import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/** A term within a session. The database keeps it inside its session's dates. */
@Entity('terms')
export class Term extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'session_id' })
  sessionId!: string;

  @Column({ type: 'citext' })
  name!: string;

  @Column({ type: 'date', name: 'starts_on' })
  startsOn!: string;

  @Column({ type: 'date', name: 'ends_on' })
  endsOn!: string;
}
