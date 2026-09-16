import { Body, Controller, Get, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '../auth/permission.matrix';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import { type Page, PaginationQueryDto, toPageRequest } from '../common/pagination/pagination';
import {
  ApiErrorResponse,
  ApiItemResponse,
  ApiPageResponse,
} from '../common/swagger/api-responses';
import {
  ClassEnrolmentDto,
  ClassSubjectDto,
  ClassSupervisorDto,
  CreateClassEnrolmentDto,
  CreateClassSubjectDto,
  CreateClassSupervisorDto,
  CreateElectiveRegistrationDto,
  CreatePersonAnchorDto,
  ElectiveRegistrationDto,
  PersonAnchorDto,
} from './academics.dto';
import { AcademicsService } from './academics.service';

/**
 * Who is in the school's academic structure, and in what capacity.
 *
 * These are the facts the teacher access rule reads: who supervises a class, who
 * teaches what, which students are enrolled where, and who registered for which
 * elective. Only an administrator may record them.
 *
 * `GET /students` is the exception, and the reason this controller exists at all
 * as a place to see the rule work. It is scoped: an administrator sees the whole
 * school, a teacher sees only the students blueprint sections 13 and 14 allow.
 */
@ApiTags('Academics')
@Controller()
export class PeopleAssignmentsController {
  constructor(private readonly academics: AcademicsService) {}

  @Get('students')
  @RequiresPermission(Permission.StudentRead)
  @ApiOperation({
    summary: 'Students this caller may see',
    description:
      'An administrator sees every student in the school. A teacher sees only students in a ' +
      'class they supervise this session, or taking a subject they teach, with electives ' +
      'counted only for registered students. The total follows the same scope.',
  })
  @ApiPageResponse(PersonAnchorDto, 'Students retrieved.')
  listStudents(@Query() query: PaginationQueryDto): Promise<Page<PersonAnchorDto>> {
    return this.academics.listStudents(toPageRequest(query));
  }

  @Post('students')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Anchor a membership as a student',
    description: 'The membership must hold the STUDENT role (422 otherwise).',
  })
  @ApiItemResponse(PersonAnchorDto, 'Student created.', HttpStatus.CREATED)
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'The body failed validation.')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'No membership with this id in this school.')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'This membership is already a student.')
  @ApiErrorResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'The membership does not hold the STUDENT role.',
  )
  createStudent(@Body() input: CreatePersonAnchorDto): Promise<PersonAnchorDto> {
    return this.academics.createStudent(input.membershipId);
  }

  @Post('teachers')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Anchor a membership as a teacher',
    description: 'The membership must hold the TEACHER role (422 otherwise).',
  })
  @ApiItemResponse(PersonAnchorDto, 'Teacher created.', HttpStatus.CREATED)
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'The body failed validation.')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'No membership with this id in this school.')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'This membership is already a teacher.')
  @ApiErrorResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'The membership does not hold the TEACHER role.',
  )
  createTeacher(@Body() input: CreatePersonAnchorDto): Promise<PersonAnchorDto> {
    return this.academics.createTeacher(input.membershipId);
  }

  @Post('class-supervisors')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({ summary: 'Assign a teacher to supervise a class' })
  @ApiItemResponse(ClassSupervisorDto, 'Supervisor assigned.', HttpStatus.CREATED)
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'The body failed validation.')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'The class or teacher does not exist in this school.')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'This teacher already supervises the class.')
  createClassSupervisor(@Body() input: CreateClassSupervisorDto): Promise<ClassSupervisorDto> {
    return this.academics.createClassSupervisor(input);
  }

  @Post('class-subjects')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Assign a teacher to a subject in a class',
    description: 'A subject is taught once per class (409 on a duplicate).',
  })
  @ApiItemResponse(ClassSubjectDto, 'Subject assigned.', HttpStatus.CREATED)
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'The body failed validation.')
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    'The class, subject or teacher does not exist in this school.',
  )
  @ApiErrorResponse(HttpStatus.CONFLICT, 'The subject is already taught in this class.')
  createClassSubject(@Body() input: CreateClassSubjectDto): Promise<ClassSubjectDto> {
    return this.academics.createClassSubject(input);
  }

  @Post('class-enrolments')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Enrol a student in a class',
    description:
      'The enrolment takes the class session. A student may be in one class per session ' +
      '(409 on a second).',
  })
  @ApiItemResponse(ClassEnrolmentDto, 'Student enrolled.', HttpStatus.CREATED)
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'The body failed validation.')
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'The class or student does not exist in this school.')
  @ApiErrorResponse(HttpStatus.CONFLICT, 'The student is already enrolled in a class this session.')
  createEnrolment(@Body() input: CreateClassEnrolmentDto): Promise<ClassEnrolmentDto> {
    return this.academics.createEnrolment(input);
  }

  @Post('elective-registrations')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Register a student for an elective',
    description:
      'The subject must be an elective, and the student must be enrolled in the class it is ' +
      'taught in (422 otherwise).',
  })
  @ApiItemResponse(ElectiveRegistrationDto, 'Registration created.', HttpStatus.CREATED)
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'The body failed validation.')
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    'The class subject or student does not exist in this school.',
  )
  @ApiErrorResponse(HttpStatus.CONFLICT, 'The student is already registered for this elective.')
  @ApiErrorResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'The subject is not an elective, or the student is not enrolled in that class.',
  )
  createElectiveRegistration(
    @Body() input: CreateElectiveRegistrationDto,
  ): Promise<ElectiveRegistrationDto> {
    return this.academics.createElectiveRegistration(input);
  }
}
