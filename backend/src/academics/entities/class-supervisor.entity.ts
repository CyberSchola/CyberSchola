import { Column, Entity } from 'typeorm';

import { TenantOwnedEntity } from '../../common/entities/tenant-owned.entity';

/** A teacher responsible for a class: the form teacher. */
@Entity('class_supervisors')
export class ClassSupervisor extends TenantOwnedEntity {
  @Column({ type: 'uuid', name: 'class_id' })
  classId!: string;

  @Column({ type: 'uuid', name: 'teacher_id' })
  teacherId!: string;
}
