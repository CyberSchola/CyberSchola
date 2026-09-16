import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Guardianship } from './entities/guardianship.entity';
import { Parent } from './entities/parent.entity';
import { SchoolAdmin } from './entities/school-admin.entity';
import { Staff } from './entities/staff.entity';
import { Student } from './entities/student.entity';
import { Teacher } from './entities/teacher.entity';
import {
  GuardianshipsController,
  ParentsController,
  SchoolAdminsController,
  StaffController,
  StudentsController,
  TeachersController,
} from './people.controller';
import { PeopleService } from './people.service';

/**
 * The people of a school and the roles they hold.
 *
 * Blueprint Phases 4 and 5: students, teachers, parents and staff as records,
 * administrators, and the parent-student relationship. A live role row linked to
 * a membership is what gives that membership a role, so this module is also
 * where roles are granted and removed.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Student, Teacher, Parent, Staff, SchoolAdmin, Guardianship])],
  controllers: [
    StudentsController,
    TeachersController,
    ParentsController,
    StaffController,
    SchoolAdminsController,
    GuardianshipsController,
  ],
  providers: [PeopleService],
})
export class PeopleModule {}
