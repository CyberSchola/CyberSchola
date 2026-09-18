import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '../auth/permission.matrix';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import { ApiErrorResponse, ApiItemResponse } from '../common/swagger/api-responses';
import {
  ClassEnrolmentDto,
  ClassSubjectDto,
  ClassSupervisorDto,
  CreateClassEnrolmentDto,
  CreateClassSubjectDto,
  CreateClassSupervisorDto,
  CreateElectiveRegistrationDto,
  ElectiveRegistrationDto,
} from './academics.dto';
import { AcademicsService } from './academics.service';

/**
 * Who is in the school's academic structure, and in what capacity.
 *
 * These are the facts the teacher access rule reads: who supervises a class, who
 * teaches what, which students are enrolled where, and who registered for which
 * elective. Only an administrator may record them. The people themselves, and
 * the scoped student list, live in the people module.
 */
@ApiTags('Academics')
@Controller()
export class AssignmentsController {
  constructor(private readonly academics: AcademicsService) {}

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
