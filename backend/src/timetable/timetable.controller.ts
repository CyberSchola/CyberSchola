import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '../auth/permission.matrix';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import {
  ApiEmptyResponse,
  ApiErrorResponse,
  ApiItemResponse,
  ApiListResponse,
} from '../common/swagger/api-responses';
import {
  CreateLessonDto,
  CreatePeriodDto,
  LessonDto,
  MoveLessonDto,
  PeriodDto,
  SessionQueryDto,
  TimetableConflictDto,
  UpdatePeriodDto,
} from './timetable.dto';
import { TimetableService } from './timetable.service';

const BODY_INVALID = 'The body failed validation.';
const NO_SESSION =
  'No session was named and the school has no current one. Pass sessionId to choose.';
const LESSON_CLASH =
  'The period is taken, and the message names by what: the teacher already teaching then, ' +
  'the class already having a core lesson, or a core lesson and an elective sharing it.';
const OTHER_SESSION = 'The period belongs to a different session from the class.';

/**
 * A school's timetable: the periods of its week, and the lessons placed in them.
 *
 * Every member may read any class's or teacher's week, since blueprint section 22
 * puts timetables among what the whole school sees. Only an administrator shapes
 * them. A caller's own week is `GET /me/timetable`.
 */
@ApiTags('Timetables')
@Controller('timetable')
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  // -------------------------------------------------------------------------
  // Periods
  // -------------------------------------------------------------------------

  @Get('periods')
  @RequiresPermission(Permission.AcademicRead)
  @ApiOperation({
    summary: 'The periods of a session',
    description: 'Every period of the week, ordered by weekday and start time.',
  })
  @ApiListResponse(PeriodDto, 'Periods retrieved.')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, '`sessionId` is not a UUID.')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'The session does not exist in this school.')
  @ApiErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY, NO_SESSION)
  listPeriods(@Query() query: SessionQueryDto): Promise<PeriodDto[]> {
    return this.timetable.listPeriods(query.sessionId);
  }

  @Post('periods')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Add a period to the week',
    description:
      'Periods on one weekday may not overlap, and a label names one period per weekday ' +
      '(409, naming the period in the way). Back to back is fine: 08:40 to 09:20 then 09:20.',
  })
  @ApiItemResponse(PeriodDto, 'Period created.', HttpStatus.CREATED)
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, BODY_INVALID)
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'The session does not exist in this school.')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'The period overlaps another, or reuses its label.')
  @ApiErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY, 'The period ends before it starts.')
  createPeriod(@Body() input: CreatePeriodDto): Promise<PeriodDto> {
    return this.timetable.createPeriod(input);
  }

  @Patch('periods/:id')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Change a period',
    description: 'Its lessons stay in it, so they move with it.',
  })
  @ApiItemResponse(PeriodDto, 'Period updated.')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, BODY_INVALID)
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'No period with this id in this school.')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'The period would overlap another, or reuse its label.')
  @ApiErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY, 'The period would end before it starts.')
  updatePeriod(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdatePeriodDto,
  ): Promise<PeriodDto> {
    return this.timetable.updatePeriod(id, input);
  }

  @Delete('periods/:id')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Remove an empty period',
    description: 'Refused while it holds lessons (409), so a slot is never emptied by accident.',
  })
  @ApiEmptyResponse('Period removed.')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'No period with this id in this school.')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'The period still holds lessons.')
  async removePeriod(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.timetable.removePeriod(id);
  }

  // -------------------------------------------------------------------------
  // Lessons
  // -------------------------------------------------------------------------

  @Post('lessons')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Place a class subject in a period',
    description:
      'The class, teacher and whether it is an elective come from the class subject. ' +
      'Electives may run beside each other; a core lesson runs alone.',
  })
  @ApiItemResponse(LessonDto, 'Lesson timetabled.', HttpStatus.CREATED)
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, BODY_INVALID)
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    'The period or class subject does not exist in this school.',
  )
  @ApiErrorResponse(HttpStatus.CONFLICT, LESSON_CLASH)
  @ApiErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY, OTHER_SESSION)
  createLesson(@Body() input: CreateLessonDto): Promise<LessonDto> {
    return this.timetable.createLesson(input);
  }

  @Patch('lessons/:id')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({ summary: 'Move a lesson to another period' })
  @ApiItemResponse(LessonDto, 'Lesson moved.')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, BODY_INVALID)
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'The lesson or period does not exist in this school.')
  @ApiErrorResponse(HttpStatus.CONFLICT, LESSON_CLASH)
  @ApiErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY, OTHER_SESSION)
  moveLesson(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: MoveLessonDto,
  ): Promise<LessonDto> {
    return this.timetable.moveLesson(id, input);
  }

  @Delete('lessons/:id')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({ summary: 'Take a lesson off the timetable' })
  @ApiEmptyResponse('Lesson removed.')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'No lesson with this id in this school.')
  async removeLesson(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.timetable.removeLesson(id);
  }

  // -------------------------------------------------------------------------
  // Weeks
  // -------------------------------------------------------------------------

  @Get('classes/:classId')
  @RequiresPermission(Permission.AcademicRead)
  @ApiOperation({
    summary: "A class's week",
    description: 'Every lesson of the class, core and elective, by weekday and start time.',
  })
  @ApiListResponse(LessonDto, 'Timetable retrieved.')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'No class with this id in this school.')
  classTimetable(@Param('classId', ParseUUIDPipe) classId: string): Promise<LessonDto[]> {
    return this.timetable.classTimetable(classId);
  }

  @Get('teachers/:teacherId')
  @RequiresPermission(Permission.AcademicRead)
  @ApiOperation({
    summary: "A teacher's week",
    description: 'Every lesson they teach in the session, across all their classes.',
  })
  @ApiListResponse(LessonDto, 'Timetable retrieved.')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, '`sessionId` is not a UUID.')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'The teacher or session does not exist in this school.')
  @ApiErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY, NO_SESSION)
  teacherTimetable(
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @Query() query: SessionQueryDto,
  ): Promise<LessonDto[]> {
    return this.timetable.teacherTimetable(teacherId, query.sessionId);
  }

  @Get('conflicts')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Pupils timetabled into two electives at once',
    description:
      'Pupils registered for more than one of the electives running in a period, each with ' +
      'every elective they take then. Reported rather than refused, since the registration ' +
      'and the lesson are made separately.',
  })
  @ApiListResponse(TimetableConflictDto, 'Conflicts retrieved.')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, '`sessionId` is not a UUID.')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'The session does not exist in this school.')
  @ApiErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY, NO_SESSION)
  conflicts(@Query() query: SessionQueryDto): Promise<TimetableConflictDto[]> {
    return this.timetable.conflicts(query.sessionId);
  }
}

/**
 * The caller's own week.
 *
 * Its own controller because the identity `me` controller is tenant-optional, and
 * a timetable is always one school's.
 */
@ApiTags('Timetables')
@Controller('me')
export class MyTimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Get('timetable')
  @RequiresPermission(Permission.AcademicRead)
  @ApiOperation({
    summary: 'My timetable',
    description:
      'The current session. A pupil gets their class and the electives they registered for, a ' +
      "parent each child's, a teacher what they teach. Someone with several roles gets them all.",
  })
  @ApiListResponse(LessonDto, 'Timetable retrieved.')
  myTimetable(): Promise<LessonDto[]> {
    return this.timetable.myTimetable();
  }
}
