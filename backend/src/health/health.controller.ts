import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SYSTEM_MESSAGES } from '../constants/system.messages';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { ApiSuccessResponseDto } from '../common/dto/api-response.dto';
import { ServiceNotReadyException } from '../common/exceptions/app.exception';
import { ReadinessService, type ReadinessReport } from './readiness.service';

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

export class DependenciesDto {
  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  database!: 'up' | 'down';
}

export class ReadinessDto {
  @ApiProperty({ example: true })
  ready!: boolean;

  @ApiProperty({ type: DependenciesDto })
  dependencies!: DependenciesDto;
}

class ReadinessResponseDto extends ApiSuccessResponseDto<ReadinessDto> {
  @ApiProperty({ type: ReadinessDto })
  declare data: ReadinessDto;
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
  constructor(private readonly readiness: ReadinessService) {}

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

  /**
   * Readiness probe.
   *
   * Answers whether this process can actually serve traffic, which liveness
   * deliberately does not. An orchestrator uses the two differently: a failing
   * liveness check restarts the process, a failing readiness check only takes
   * it out of rotation. Reporting a dead database as a liveness failure would
   * make every replica restart in a loop while the database is down, which
   * helps nobody.
   *
   * Returns 503 when a dependency is down, so the status alone is enough for a
   * load balancer that does not read the body.
   */
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Unauthenticated. Reports whether every dependency this process needs is reachable. Returns 503 when one is not.',
  })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({ description: 'At least one dependency is unreachable.' })
  @ResponseMessage(SYSTEM_MESSAGES.HEALTH.READY)
  async readinessProbe(): Promise<ReadinessReport> {
    const report = await this.readiness.check();

    if (!report.ready) {
      // Thrown rather than returned, so the exception filter renders it in the
      // same envelope as every other failure and the status is a real 503.
      //
      // The report itself is deliberately not attached. Naming the failing
      // dependency to an unauthenticated caller describes our infrastructure
      // to anyone who asks; it is in the log instead.
      throw new ServiceNotReadyException();
    }

    return report;
  }
}
