import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

import { SYSTEM_MESSAGES } from '../constants/system.messages';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { ApiSuccessResponseDto } from '../common/dto/api-response.dto';

export class LivenessDto {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: 'cyberschola-backend' })
  service!: string;

  @ApiProperty({ example: '0.1.0' })
  version!: string;

  @ApiProperty({ example: 42, description: 'Seconds since this process started.' })
  uptimeSeconds!: number;
}

class LivenessResponseDto extends ApiSuccessResponseDto<LivenessDto> {
  @ApiProperty({ type: LivenessDto })
  declare data: LivenessDto;
}

/**
 * Liveness probe.
 *
 * Deliberately dependency-free: it answers "is this process running", not
 * "can this process reach Postgres and Redis". The readiness probe that
 * checks those arrives with the database and Redis modules in BE-F03, so a
 * failing dependency never takes a healthy process out of rotation before
 * there is anything meaningful to report.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Unauthenticated. Reports only that the process is up. It does not check the database, Redis, or any other dependency.',
  })
  @ApiOkResponse({ type: LivenessResponseDto })
  @ResponseMessage(SYSTEM_MESSAGES.HEALTH.LIVE)
  liveness(): LivenessDto {
    return {
      status: 'ok',
      service: 'cyberschola-backend',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
