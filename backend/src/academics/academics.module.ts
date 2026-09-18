import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AcademicStructureController } from './academic-structure.controller';
import { AcademicsService } from './academics.service';
import { AcademicSession } from './entities/academic-session.entity';
import { ClassEnrolment } from './entities/class-enrolment.entity';
import { ClassSubject } from './entities/class-subject.entity';
import { ClassSupervisor } from './entities/class-supervisor.entity';
import { ElectiveRegistration } from './entities/elective-registration.entity';
import { GradeLevel } from './entities/grade-level.entity';
import { SchoolClass } from './entities/school-class.entity';
import { Student } from './entities/student.entity';
import { Subject } from './entities/subject.entity';
import { Teacher } from './entities/teacher.entity';
import { Term } from './entities/term.entity';
import { PeopleAssignmentsController } from './people-assignments.controller';

/**
 * The academic spine, blueprint section 22 steps three to nine.
 *
 * Exports nothing yet. When attendance, results and lesson notes arrive, they
 * will import `teacherAccessScope` from `teacher-access.scope.ts` directly, since
 * it is a pure query fragment rather than a provider, and that one function is
 * what keeps every module's teacher rule identical.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AcademicSession,
      Term,
      GradeLevel,
      SchoolClass,
      Subject,
      Student,
      Teacher,
      ClassSupervisor,
      ClassSubject,
      ClassEnrolment,
      ElectiveRegistration,
    ]),
  ],
  controllers: [AcademicStructureController, PeopleAssignmentsController],
  providers: [AcademicsService],
})
export class AcademicsModule {}
