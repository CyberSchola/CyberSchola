import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Base for every row that belongs to a school.
 *
 * Two concerns live here and they are deliberately separate columns, per
 * decision 7A. Record lifecycle (`deletedAt`, `archivedAt`) says whether a row
 * is still in play. Domain status, where an entity has one, says where it sits
 * in its own workflow. Collapsing them produces the ambiguity where `ARCHIVED`
 * means a superseded lesson note in one table and a graduated student in
 * another, and every query then filters on a union of unrelated states.
 */
export abstract class TenantOwnedEntity {
  /**
   * Random rather than sequential.
   *
   * A sequential id leaks how many rows exist and the order they were created
   * in. In a multi-tenant system it also leaks the rate at which other schools
   * are using the platform, which is commercially sensitive and none of their
   * business.
   */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The school this row belongs to.
   *
   * Not nullable, and indexed because every tenant-scoped query filters on it
   * and the row-level security policy compares against it on every access.
   *
   * This column is what the RLS policy reads. Nothing in application code
   * should ever set it from a request body: it comes from the authenticated
   * membership, and the database refuses rows that disagree with the session's
   * tenant regardless.
   */
  @Index()
  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  /**
   * Soft delete, per decision 8A.
   *
   * TypeORM excludes these rows automatically once `@DeleteDateColumn` is
   * present, so a query has to opt in with `withDeleted` to see them.
   *
   * The part that is easy to miss: every unique constraint on a soft-deletable
   * table must become a partial index on `deleted_at IS NULL`. Otherwise the
   * soft-deleted row still occupies the value, and recreating a student with
   * the same admission number fails. That is the framework default, not an
   * edge case.
   */
  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  /** Who deleted it. Null while the row is live. */
  @Column({ type: 'uuid', name: 'deleted_by', nullable: true })
  deletedBy!: string | null;

  /**
   * Archived rather than deleted.
   *
   * A graduated student and a student created by mistake are different things.
   * The first is archived and keeps its history; the second is soft deleted.
   * Conflating them is how a school loses the record of everyone who ever
   * attended.
   */
  @Column({ type: 'timestamptz', name: 'archived_at', nullable: true })
  archivedAt!: Date | null;
}
