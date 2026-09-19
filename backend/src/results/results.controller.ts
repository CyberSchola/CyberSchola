import { Body, Controller, Get, HttpStatus, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '../auth/permission.matrix';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import { ApiErrorResponse, ApiItemResponse } from '../common/swagger/api-responses';
import {
  PerformanceDto,
  PerformanceQueryDto,
  SavedScoresDto,
  SaveScoresDto,
  ScoreSheetDto,
  ScoreSheetQueryDto,
} from './results.dto';
import { ResultsService } from './results.service';

@ApiTags('Results')
@Controller('results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get('performance')
  @RequiresPermission(Permission.ResultRead)
  @ApiOperation({
    summary: 'Performance for a term',
    description:
      "Each pupil's CA1, CA2, exam and total per subject, and each subject's summary. " +
      'Narrowed to the pupils this caller may see: an administrator the school, a teacher the ' +
      'pupils they teach, a parent their children, a pupil themselves. Attendance rates are ' +
      'included for administrators.',
  })
  @ApiItemResponse(PerformanceDto, 'Performance retrieved.')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'A filter is not a UUID.')
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    'The session, term or class does not exist in this school.',
  )
  @ApiErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY, 'No current session, or no terms yet.')
  performance(@Query() query: PerformanceQueryDto): Promise<PerformanceDto> {
    return this.results.performance(query);
  }

  @Get('sheet')
  @RequiresPermission(Permission.ResultEnter)
  @ApiOperation({
    summary: 'A score sheet',
    description:
      "One class subject's scores for a term: every pupil who takes it, with CA1, CA2, exam " +
      'and total, scored or not. For the teacher of that class subject, or an administrator.',
  })
  @ApiItemResponse(ScoreSheetDto, 'Score sheet retrieved.')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'classSubjectId or termId is missing or not a UUID.')
  @ApiErrorResponse(HttpStatus.FORBIDDEN, 'The caller does not teach this class subject.')
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    'The class subject or term does not exist in this school.',
  )
  @ApiErrorResponse(HttpStatus.UNPROCESSABLE_ENTITY, "The term is not in the class's session.")
  sheet(@Query() query: ScoreSheetQueryDto): Promise<ScoreSheetDto> {
    return this.results.sheet(query);
  }

  @Put('sheet')
  @RequiresPermission(Permission.ResultEnter)
  @ApiOperation({
    summary: 'Enter or correct scores',
    description:
      "Saves one assessment's scores (CA1 or CA2 out of 20, the exam out of 60) for a class " +
      'subject in a term. A pupil with no score gets one; a pupil with one has it corrected, ' +
      'recorded as changed by the caller. All or nothing: one refused entry saves none. ' +
      'Returns the updated sheet.',
  })
  @ApiItemResponse(SavedScoresDto, 'Scores saved.')
  @ApiErrorResponse(HttpStatus.BAD_REQUEST, 'The body is malformed, or a score is out of range.')
  @ApiErrorResponse(HttpStatus.FORBIDDEN, 'The caller does not teach this class subject.')
  @ApiErrorResponse(
    HttpStatus.NOT_FOUND,
    'The class subject or term does not exist in this school.',
  )
  @ApiErrorResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'A score is over the assessment maximum, a pupil does not take the subject, a pupil is ' +
      "named twice, or the term is not in the class's session.",
  )
  save(@Body() dto: SaveScoresDto): Promise<SavedScoresDto> {
    return this.results.save(dto);
  }
}
