import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './config/env.validation';
import { HealthController } from './health/health.controller';

/**
 * Root module.
 *
 * The database, Redis and queue modules arrive in BE-F03.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
      // Boots or refuses to boot. A bad value should never survive to the
      // first request.
      validate: validateEnv,
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
