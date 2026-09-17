import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AttendanceRecordsController,
  EmployeeAttendanceController,
  StudentAttendanceController,
} from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceCorrection } from './entities/attendance-correction.entity';
import { Attendance } from './entities/attendance.entity';

/**
 * Attendance for students, teachers and staff.
 *
 * Blueprint sections 89 to 96. It sits above the academic spine and the people
 * module, because a student's attendance is recorded against the enrolment that
 * places them in a class, and who may mark or read it is decided by the role
 * rows those modules own.
 *
 * Sections 97 and 98, the daily, weekly, monthly, term and session reports and
 * the Redis summaries that cache them, are deliberately not here. They are a
 * reporting surface over this table and they arrive in BE-AT02, with the cache
 * invalidation the writes here will feed.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Attendance, AttendanceCorrection])],
  controllers: [
    StudentAttendanceController,
    EmployeeAttendanceController,
    AttendanceRecordsController,
  ],
  providers: [AttendanceService],
})
export class AttendanceModule {}
