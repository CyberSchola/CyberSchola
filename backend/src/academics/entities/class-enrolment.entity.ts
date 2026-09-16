import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/**
 * A student in a class for a session.
 *
 * `sessionId` duplicates the class's session, and the composite foreign key to
 * `classes (tenant_id, id, session_id)` guarantees the two agree. It exists so
 * the database can forbid enrolling one student in two classes in a session.
 */
@Entity('class_enrolments')
export class ClassEnrolment extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'class_id' })
  classId!: string;

  @Column({ type: 'uuid', name: 'session_id' })
  sessionId!: string;

  @Column({ type: 'uuid', name: 'student_id' })
  studentId!: string;
}
