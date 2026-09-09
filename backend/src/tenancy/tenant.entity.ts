import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TenantStatus {
  /** Using the platform normally. */
  Active = 'ACTIVE',
  /** Kept for its history, but nobody may sign in. */
  Archived = 'ARCHIVED',
  /** Created in error, or removed before going live. */
  SoftDeleted = 'SOFT_DELETED',
}

/**
 * A school.
 *
 * The root of every tenant boundary in the system, and deliberately **not** a
 * `TenantOwnedEntity`: a school is not owned by a school. It is the thing that
 * owns everything else, so it carries no `tenantId` and no row-level security
 * policy of its own. Access to this table is controlled by role, not by policy.
 *
 * Everything else in the schema references `tenants.id`, and the RLS policy on
 * those tables compares that column against the tenant set on the session.
 */
@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  /**
   * Short, human-typed identifier for the school.
   *
   * `citext` so that `Greenfield` and `greenfield` are the same school. Doing
   * this with `lower()` on every query is both easy to forget and unable to
   * use a plain unique index.
   *
   * Unique among live schools only. The uniqueness is a partial index defined
   * in the migration rather than here, because TypeORM's `unique: true` emits
   * a plain constraint, and that would keep a soft-deleted school's slug
   * reserved forever.
   */
  @Column({ type: 'citext' })
  slug!: string;

  @Column({ type: 'enum', enum: TenantStatus, default: TenantStatus.Active })
  status!: TenantStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'archived_at', nullable: true })
  archivedAt!: Date | null;
}
