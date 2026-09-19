import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/** A student taking an elective. Core subjects need no row. */
@Entity('elective_registrations')
export class ElectiveRegistration extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'class_subject_id' })
  classSubjectId!: string;

  @Column({ type: 'uuid', name: 'student_id' })
  studentId!: string;
}
