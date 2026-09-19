import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '../auth/permission.matrix';
import { RequiresPermission } from '../auth/requires-permission.decorator';
import { ApiErrorResponse, ApiItemResponse } from '../common/swagger/api-responses';
import { PerformanceDto, PerformanceQueryDto } from './results.dto';
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
}
