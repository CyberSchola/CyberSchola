import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../common/entities/tenant-owned.entity';

/** One assessment score for one pupil in one subject and term. See CreateResults. */
@Entity('results')
export class Result extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'student_id' }) studentId!: string;
  @Column({ type: 'uuid', name: 'enrolment_id' }) enrolmentId!: string;
  @Column({ type: 'uuid', name: 'class_id' }) classId!: string;
  @Column({ type: 'uuid', name: 'session_id' }) sessionId!: string;
  @Column({ type: 'uuid', name: 'term_id' }) termId!: string;
  @Column({ type: 'uuid', name: 'class_subject_id' }) classSubjectId!: string;
  @Column({ type: 'uuid', name: 'subject_id' }) subjectId!: string;
  @Column({ type: 'enum', enum: ['CA1', 'CA2', 'EXAM'], name: 'assessment_type' })
  assessmentType!: 'CA1' | 'CA2' | 'EXAM';
  @Column({ type: 'numeric', precision: 5, scale: 2 }) score!: string;
  @Column({ type: 'numeric', precision: 5, scale: 2, name: 'max_score' }) maxScore!: string;
  @Column({ type: 'date', name: 'assessed_on' }) assessedOn!: string;
  @Column({ type: 'text', nullable: true }) remarks!: string | null;
  @Column({ type: 'uuid', name: 'recorded_by' }) recordedBy!: string;
}
