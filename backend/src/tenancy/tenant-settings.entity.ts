import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

import { TenantOwnedEntity } from '../common/entities/tenant-owned.entity';
import { Tenant } from './tenant.entity';

/**
 * Per-school configuration.
 *
 * The first tenant-owned table, so it is also the one the row-level security
 * policy is proven against. The blueprint needs it independently: lesson note
 * format and similar settings differ per school and cannot be hardcoded.
 */
@Entity('tenant_settings')
export class TenantSetting extends TenantOwnedEntity {
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  /**
   * `citext`, so `lessonNoteFormat` and `lessonnoteformat` are the same
   * setting rather than two rows that silently disagree.
   *
   * Unique per school among live rows only. The partial index lives in the
   * migration, because TypeORM's `unique: true` emits a plain constraint that
   * would keep a soft-deleted key reserved forever.
   */
  @Column({ type: 'citext', name: 'setting_key' })
  settingKey!: string;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  value!: Record<string, unknown>;
}
