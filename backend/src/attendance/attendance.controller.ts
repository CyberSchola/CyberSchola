import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '../auth/permission.matrix';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import { type Page, toPageRequest } from '../common/pagination/pagination';
import {
  ApiErrorResponse,
  ApiItemResponse,
  ApiListResponse,
  ApiPageResponse,
} from '../common/swagger/api-responses';
import {
  AttendanceCorrectionDto,
  AttendanceDto,
  AttendanceQueryDto,
  CorrectAttendanceDto,
  MarkClassAttendanceDto,
  MarkEmployeeAttendanceDto,
  SelfCheckInDto,
} from './attendance.dto';
import { AttendanceType } from './attendance.enums';
import {
  ALREADY_MARKED_MESSAGE,
  AttendanceService,
  OUTSIDE_TERM_MESSAGE,
} from './attendance.service';

const BODY_INVALID = 'The body failed validation.';
const SCOPE_NOTE =
  'Rows are narrowed to what this caller may see: an administrator the whole school, a teacher ' +
  'the students they reach plus their own record, a parent their linked children, a student and ' +
  'a staff member themselves.';

/*
 * Three controllers, split by surface rather than by subject type.
 *
 * A class register and a self check-in are different requests with different
 * bodies and different rules, and they happen to both be attendance. Splitting by
 * STUDENT/TEACHER/STAFF would have put bulk roster marking and single-record
 * marking in the same class and separated the two employee surfaces that are
 * identical. As in the people module these are written out rather than produced
 * by a factory, because a factory-built route erases the body type that the
 * global ValidationPipe reads, and the route would silently skip validation.
 */

@ApiTags('Attendance')
@Controller()
export class StudentAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('classes/:classId/attendance')
  @RequiresPermission(Permission.AttendanceMark)
  @ApiOperation({
    summary: 'Take a class register for one day',
    description:
      'Marks every student in one request and one transaction, so a saved register is never ' +
      'half a register. Creates records and never changes one: a day that is already recorded ' +
      'is a 409 naming the students, and changing a status is POST /attendance/{id}/corrections, ' +
      'which records who changed it and why. A teacher may do this for a class they supervise ' +
      'in the current session, and an administrator for any class.',
  })
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, BODY_INVALID)
  @ApiErrorResponse(
    HttpStatus.FORBIDDEN,
    'This caller does not supervise that class in the current session.',
  )
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'No class with this id in this school.')
  @ApiErrorResponse(HttpStatus.CONFLICT, ALREADY_MARKED_MESSAGE)
  @ApiErrorResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    `A student named is not enrolled in that class, a status is not one a student may hold, the ` +
      `date is in the future, or ${OUTSIDE_TERM_MESSAGE.toLowerCase()}`,
  )
  @ApiListResponse(AttendanceDto, 'Register recorded.', HttpStatus.CREATED)
  markClass(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() input: MarkClassAttendanceDto,
  ): Promise<AttendanceDto[]> {
    return this.attendance.markClass(classId, input);
  }

  @Get('classes/:classId/attendance')
  @RequiresPermission(Permission.AttendanceRead)
  @ApiOperation({
    summary: "One class's attendance",
    description: `Pass \`date\` for a single day's register, or \`from\` and \`to\` for a range. ${SCOPE_NOTE}`,
  })
  @ApiPageResponse(AttendanceDto, 'Attendance retrieved.')
  listForClass(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query() query: AttendanceQueryDto,
  ): Promise<Page<AttendanceDto>> {
    return this.attendance.list({ ...filterOf(query), classId }, toPageRequest(query));
  }

  @Get('students/:studentId/attendance')
  @RequiresPermission(Permission.AttendanceRead)
  @ApiOperation({
    summary: "One student's attendance history",
    description: `Pass \`from\` and \`to\` for a term or a week. ${SCOPE_NOTE} A student this caller may not see returns an empty page rather than a 403, for the same reason a student they may not see is a 404: the answer must not reveal that the record exists.`,
  })
  @ApiPageResponse(AttendanceDto, 'Attendance retrieved.')
  listForStudent(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: AttendanceQueryDto,
  ): Promise<Page<AttendanceDto>> {
    return this.attendance.list({ ...filterOf(query), studentId }, toPageRequest(query));
  }
}

@ApiTags('Attendance')
@Controller()
export class EmployeeAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('teachers/:teacherId/attendance')
  @RequiresPermission(Permission.AttendanceMark)
  @ApiOperation({
    summary: "Record a teacher's day",
    description:
      'An administrator records anyone; a teacher records only themselves, and normally through ' +
      'POST /me/attendance/check-in instead. Teachers and staff may be given LEAVE, which a ' +
      'student may not.',
  })
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, BODY_INVALID)
  @ApiErrorResponse(HttpStatus.FORBIDDEN, 'This caller may only record their own attendance.')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'No teacher with this id in this school.')
  @ApiErrorResponse(HttpStatus.CONFLICT, ALREADY_MARKED_MESSAGE)
  @ApiItemResponse(AttendanceDto, 'Attendance recorded.', HttpStatus.CREATED)
  markTeacher(
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @Body() input: MarkEmployeeAttendanceDto,
  ): Promise<AttendanceDto> {
    return this.attendance.markEmployee(AttendanceType.Teacher, teacherId, input);
  }

  @Post('staff/:staffId/attendance')
  @RequiresPermission(Permission.AttendanceMark)
  @ApiOperation({
    summary: "Record a staff member's day",
    description:
      'An administrator records anyone; a staff member records only themselves, which is ' +
      'blueprint section 95. Self check-in is POST /me/attendance/check-in.',
  })
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, BODY_INVALID)
  @ApiErrorResponse(HttpStatus.FORBIDDEN, 'This caller may only record their own attendance.')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'No staff record with this id in this school.')
  @ApiErrorResponse(HttpStatus.CONFLICT, ALREADY_MARKED_MESSAGE)
  @ApiItemResponse(AttendanceDto, 'Attendance recorded.', HttpStatus.CREATED)
  markStaff(
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() input: MarkEmployeeAttendanceDto,
  ): Promise<AttendanceDto> {
    return this.attendance.markEmployee(AttendanceType.Staff, staffId, input);
  }

  @Post('me/attendance/check-in')
  @RequiresPermission(Permission.AttendanceMark)
  @ApiOperation({
    summary: 'Check yourself in',
    description:
      'For teachers and staff. There is no id in this request: the record is found from the ' +
      "caller's own role row in this school, so it cannot name anyone else. The date defaults " +
      'to today and the status to PRESENT.',
  })
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, BODY_INVALID)
  @ApiErrorResponse(HttpStatus.FORBIDDEN, 'Only teachers and staff record their own attendance.')
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    'This account is not linked to a staff or teacher record in this school.',
  )
  @ApiErrorResponse(HttpStatus.CONFLICT, ALREADY_MARKED_MESSAGE)
  @ApiItemResponse(AttendanceDto, 'Checked in.', HttpStatus.CREATED)
  checkIn(@Body() input: SelfCheckInDto): Promise<AttendanceDto> {
    return this.attendance.checkInSelf(input);
  }

  @Get('teachers/:teacherId/attendance')
  @RequiresPermission(Permission.AttendanceRead)
  @ApiOperation({ summary: "One teacher's attendance", description: SCOPE_NOTE })
  @ApiPageResponse(AttendanceDto, 'Attendance retrieved.')
  listForTeacher(
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @Query() query: AttendanceQueryDto,
  ): Promise<Page<AttendanceDto>> {
    return this.attendance.list({ ...filterOf(query), teacherId }, toPageRequest(query));
  }

  @Get('staff/:staffId/attendance')
  @RequiresPermission(Permission.AttendanceRead)
  @ApiOperation({ summary: "One staff member's attendance", description: SCOPE_NOTE })
  @ApiPageResponse(AttendanceDto, 'Attendance retrieved.')
  listForStaff(
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Query() query: AttendanceQueryDto,
  ): Promise<Page<AttendanceDto>> {
    return this.attendance.list({ ...filterOf(query), staffId }, toPageRequest(query));
  }
}

@ApiTags('Attendance')
@Controller('attendance')
export class AttendanceRecordsController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @RequiresPermission(Permission.AttendanceRead)
  @ApiOperation({
    summary: 'Attendance this caller may see',
    description: `Across all three kinds of person, filtered by \`attendanceType\`, a single \`date\` or a \`from\` and \`to\` range. ${SCOPE_NOTE} The total follows the same scope.`,
  })
  @ApiPageResponse(AttendanceDto, 'Attendance retrieved.')
  list(@Query() query: AttendanceQueryDto): Promise<Page<AttendanceDto>> {
    return this.attendance.list(filterOf(query), toPageRequest(query));
  }

  @Get(':id')
  @RequiresPermission(Permission.AttendanceRead)
  @ApiOperation({
    summary: 'One attendance record',
    description: 'A record this caller may not see is 404, identical to an id that does not exist.',
  })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'No record with this id that this caller may see.')
  @ApiItemResponse(AttendanceDto, 'Record retrieved.')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AttendanceDto> {
    return this.attendance.get(id);
  }

  @Get(':id/corrections')
  @RequiresPermission(Permission.AttendanceRead)
  @ApiOperation({
    summary: 'What has been changed on a record',
    description:
      'Newest first. Every entry carries the previous status, the new one, the membership that ' +
      'made the change, the reason and when. Written by the database rather than by this ' +
      'service, so no change can be missing from it.',
  })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'No record with this id that this caller may see.')
  @ApiListResponse(AttendanceCorrectionDto, 'History retrieved.')
  corrections(@Param('id', ParseUUIDPipe) id: string): Promise<AttendanceCorrectionDto[]> {
    return this.attendance.corrections(id);
  }

  @Post(':id/corrections')
  @RequiresPermission(Permission.AttendanceCorrect)
  @ApiOperation({
    summary: 'Correct a recorded status',
    description:
      'Administrators only, per blueprint section 95. The reason is required and is recorded ' +
      'with the change: the database refuses an update that carries none, so a status cannot be ' +
      'changed without a trail by this endpoint or by anything else.',
  })
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, BODY_INVALID)
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'No record with this id that this caller may see.')
  @ApiErrorResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'The record already has that status, or the status is not one that kind of record may hold.',
  )
  @ApiItemResponse(AttendanceDto, 'Record corrected.', HttpStatus.CREATED)
  correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CorrectAttendanceDto,
  ): Promise<AttendanceDto> {
    return this.attendance.correct(id, input);
  }
}

/**
 * The filter part of a query, without the paging part.
 *
 * Written once so a new controller cannot forget one of the date fields and
 * silently ignore what a caller asked for.
 */
function filterOf(query: AttendanceQueryDto): {
  attendanceType?: AttendanceType;
  date?: string;
  from?: string;
  to?: string;
} {
  return {
    attendanceType: query.attendanceType,
    date: query.date,
    from: query.from,
    to: query.to,
  };
}
