import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { TenancyModule } from './tenancy/tenancy.module';

/**
 * Root module.
 *
 * Booted by both entry points: main.ts serves HTTP, worker.ts runs the same
 * graph without a listener. Queue processors arrive with the first real job in
 * P8.
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
    RedisModule,
    TenancyModule,
    HealthModule,
  ],
})
export class AppModule {}
