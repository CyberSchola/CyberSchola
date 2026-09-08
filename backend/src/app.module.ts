import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

/**
 * Root module.
 *
 * Redis, the cache wrapper and the queue worker arrive in BE-F04.
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
    DatabaseModule,
    HealthModule,
  ],
})
export class AppModule {}
