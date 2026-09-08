import { Controller, Get } from '@nestjs/common';

export interface LivenessResponse {
  status: 'ok';
  service: string;
  version: string;
  uptimeSeconds: number;
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
@Controller('health')
export class HealthController {
  @Get()
  liveness(): LivenessResponse {
    return {
      status: 'ok',
      service: 'cyberschola-backend',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
