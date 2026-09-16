import { Body, Controller, Get, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '../auth/permission.matrix';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { type Page, PaginationQueryDto, toPageRequest } from '../common/pagination/pagination';
import { ApiItemResponse, ApiPageResponse } from '../common/swagger/api-responses';
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
  @ApiPageResponse(PersonAnchorDto)
  @ResponseMessage('Students retrieved.')
  listStudents(@Query() query: PaginationQueryDto): Promise<Page<PersonAnchorDto>> {
    return this.academics.listStudents(toPageRequest(query));
  }

  @Post('students')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Anchor a membership as a student',
    description: 'The membership must hold the STUDENT role (422 otherwise).',
  })
  @ApiItemResponse(PersonAnchorDto, HttpStatus.CREATED)
  @ResponseMessage('Student created.')
  createStudent(@Body() input: CreatePersonAnchorDto): Promise<PersonAnchorDto> {
    return this.academics.createStudent(input.membershipId);
  }

  @Post('teachers')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Anchor a membership as a teacher',
    description: 'The membership must hold the TEACHER role (422 otherwise).',
  })
  @ApiItemResponse(PersonAnchorDto, HttpStatus.CREATED)
  @ResponseMessage('Teacher created.')
  createTeacher(@Body() input: CreatePersonAnchorDto): Promise<PersonAnchorDto> {
    return this.academics.createTeacher(input.membershipId);
  }

  @Post('class-supervisors')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({ summary: 'Assign a teacher to supervise a class' })
  @ApiItemResponse(ClassSupervisorDto, HttpStatus.CREATED)
  @ResponseMessage('Supervisor assigned.')
  createClassSupervisor(@Body() input: CreateClassSupervisorDto): Promise<ClassSupervisorDto> {
    return this.academics.createClassSupervisor(input);
  }

  @Post('class-subjects')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Assign a teacher to a subject in a class',
    description: 'A subject is taught once per class (409 on a duplicate).',
  })
  @ApiItemResponse(ClassSubjectDto, HttpStatus.CREATED)
  @ResponseMessage('Subject assigned.')
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
  @ApiItemResponse(ClassEnrolmentDto, HttpStatus.CREATED)
  @ResponseMessage('Student enrolled.')
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
  @ApiItemResponse(ElectiveRegistrationDto, HttpStatus.CREATED)
  @ResponseMessage('Registration created.')
  createElectiveRegistration(
    @Body() input: CreateElectiveRegistrationDto,
  ): Promise<ElectiveRegistrationDto> {
    return this.academics.createElectiveRegistration(input);
  }
}
