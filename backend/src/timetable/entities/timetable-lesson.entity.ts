import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/**
 * A class subject taught in a period.
 *
 * The session, class, teacher and electiveness are copies the clash rules need
 * on this table. Composite foreign keys pin each one to its source, so they are
 * set from the period and the class subject when a lesson is made and are never
 * written independently.
 */
@Entity('timetable_lessons')
export class TimetableLesson extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'session_id' })
  sessionId!: string;

  @Column({ type: 'uuid', name: 'period_id' })
  periodId!: string;

  @Column({ type: 'uuid', name: 'class_id' })
  classId!: string;

  @Column({ type: 'uuid', name: 'class_subject_id' })
  classSubjectId!: string;

  @Column({ type: 'uuid', name: 'teacher_id' })
  teacherId!: string;

  @Column({ type: 'boolean', name: 'is_elective' })
  isElective!: boolean;
}
