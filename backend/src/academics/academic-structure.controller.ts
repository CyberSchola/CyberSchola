import {
  Body,
  Controller,
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
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { type Page, PaginationQueryDto, toPageRequest } from '../common/pagination/pagination';
import { ApiItemResponse, ApiPageResponse } from '../common/swagger/api-responses';
import {
  AcademicSessionDto,
  ClassDto,
  CreateAcademicSessionDto,
  CreateClassDto,
  CreateGradeLevelDto,
  CreateSubjectDto,
  CreateTermDto,
  GradeLevelDto,
  SubjectDto,
  TermDto,
} from './academics.dto';
import { AcademicsService } from './academics.service';

/**
 * The academic structure of a school: sessions, terms, grade levels, classes and
 * subjects.
 *
 * Every member may read it, since knowing which classes exist is not sensitive
 * within a school. Only an administrator may change it, per blueprint section 12.
 * Both are declared per route, so the conformance gate sees every one.
 *
 * Invalid combinations are refused by the database rather than here: an
 * overlapping term is 409, a term outside its session 422, a class in a session
 * belonging to another school 404. Those rules only hold under concurrent writes
 * if Postgres enforces them, so that is where they live.
 */
@ApiTags('Academics')
@Controller()
export class AcademicStructureController {
  constructor(private readonly academics: AcademicsService) {}

  @Get('academic-sessions')
  @RequiresPermission(Permission.AcademicRead)
  @ApiOperation({ summary: 'Academic sessions' })
  @ApiPageResponse(AcademicSessionDto)
  @ResponseMessage('Sessions retrieved.')
  listSessions(@Query() query: PaginationQueryDto): Promise<Page<AcademicSessionDto>> {
    return this.academics.listSessions(toPageRequest(query));
  }

  @Post('academic-sessions')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Create an academic session',
    description:
      'Sessions in a school may not overlap; an overlapping session is refused with 409.',
  })
  @ApiItemResponse(AcademicSessionDto, HttpStatus.CREATED)
  @ResponseMessage('Session created.')
  createSession(@Body() input: CreateAcademicSessionDto): Promise<AcademicSessionDto> {
    return this.academics.createSession(input);
  }

  @Patch('academic-sessions/:id/current')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Make a session the current one',
    description:
      'Every teacher reaches students through the current session, so this moves all teacher ' +
      'access to the chosen year at once.',
  })
  @ApiItemResponse(AcademicSessionDto)
  @ResponseMessage('Current session updated.')
  setCurrentSession(@Param('id', ParseUUIDPipe) id: string): Promise<AcademicSessionDto> {
    return this.academics.setCurrentSession(id);
  }

  @Get('terms')
  @RequiresPermission(Permission.AcademicRead)
  @ApiOperation({ summary: 'Terms' })
  @ApiPageResponse(TermDto)
  @ResponseMessage('Terms retrieved.')
  listTerms(@Query() query: PaginationQueryDto): Promise<Page<TermDto>> {
    return this.academics.listTerms(toPageRequest(query));
  }

  @Post('terms')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Create a term',
    description:
      'A term must sit within its session (422 otherwise) and must not overlap another term in ' +
      'the same session (409 otherwise).',
  })
  @ApiItemResponse(TermDto, HttpStatus.CREATED)
  @ResponseMessage('Term created.')
  createTerm(@Body() input: CreateTermDto): Promise<TermDto> {
    return this.academics.createTerm(input);
  }

  @Get('grade-levels')
  @RequiresPermission(Permission.AcademicRead)
  @ApiOperation({ summary: 'Grade levels' })
  @ApiPageResponse(GradeLevelDto)
  @ResponseMessage('Grade levels retrieved.')
  listGradeLevels(@Query() query: PaginationQueryDto): Promise<Page<GradeLevelDto>> {
    return this.academics.listGradeLevels(toPageRequest(query));
  }

  @Post('grade-levels')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({ summary: 'Create a grade level' })
  @ApiItemResponse(GradeLevelDto, HttpStatus.CREATED)
  @ResponseMessage('Grade level created.')
  createGradeLevel(@Body() input: CreateGradeLevelDto): Promise<GradeLevelDto> {
    return this.academics.createGradeLevel(input);
  }

  @Get('classes')
  @RequiresPermission(Permission.AcademicRead)
  @ApiOperation({ summary: 'Classes' })
  @ApiPageResponse(ClassDto)
  @ResponseMessage('Classes retrieved.')
  listClasses(@Query() query: PaginationQueryDto): Promise<Page<ClassDto>> {
    return this.academics.listClasses(toPageRequest(query));
  }

  @Post('classes')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({
    summary: 'Create a class',
    description:
      'A class is a grade level and an arm within one session. The arm is compared ' +
      'case-insensitively, so "a" and "A" are the same class.',
  })
  @ApiItemResponse(ClassDto, HttpStatus.CREATED)
  @ResponseMessage('Class created.')
  createClass(@Body() input: CreateClassDto): Promise<ClassDto> {
    return this.academics.createClass(input);
  }

  @Get('subjects')
  @RequiresPermission(Permission.AcademicRead)
  @ApiOperation({ summary: 'Subjects' })
  @ApiPageResponse(SubjectDto)
  @ResponseMessage('Subjects retrieved.')
  listSubjects(@Query() query: PaginationQueryDto): Promise<Page<SubjectDto>> {
    return this.academics.listSubjects(toPageRequest(query));
  }

  @Post('subjects')
  @RequiresPermission(Permission.AcademicManage)
  @ApiOperation({ summary: 'Create a subject' })
  @ApiItemResponse(SubjectDto, HttpStatus.CREATED)
  @ResponseMessage('Subject created.')
  createSubject(@Body() input: CreateSubjectDto): Promise<SubjectDto> {
    return this.academics.createSubject(input);
  }
}
