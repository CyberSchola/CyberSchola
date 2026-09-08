import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { HealthController } from './health/health.controller';

/**
 * Root module.
 *
 * Kept deliberately thin. Configuration validation, the response envelope,
 * the exception filter and Swagger arrive in BE-F02; the database, Redis and
 * queue modules arrive in BE-F03.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
