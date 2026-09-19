import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/**
 * A subject taught in a class, by a teacher.
 *
 * `isElective` decides who takes it: everyone enrolled in the class for a core
 * subject, only registered students for an elective.
 */
@Entity('class_subjects')
export class ClassSubject extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'class_id' })
  classId!: string;

  @Column({ type: 'uuid', name: 'subject_id' })
  subjectId!: string;

  @Column({ type: 'uuid', name: 'teacher_id' })
  teacherId!: string;

  @Column({ type: 'boolean', name: 'is_elective', default: false })
  isElective!: boolean;
}
