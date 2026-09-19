import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AttendanceRecordsController,
  EmployeeAttendanceController,
  StudentAttendanceController,
} from './attendance.controller';
import { AttendanceReportCache } from './attendance-report-cache';
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
 * Sections 97 and 98 arrived in BE-AT02: reports over the same scoped query as
 * the record list, and whole-school summaries cached in Redis under a per-school
 * generation that every attendance write moves on.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Attendance, AttendanceCorrection])],
  controllers: [
    StudentAttendanceController,
    EmployeeAttendanceController,
    AttendanceRecordsController,
  ],
  providers: [AttendanceService, AttendanceReportCache],
})
export class AttendanceModule {}
