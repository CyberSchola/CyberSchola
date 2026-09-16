import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { AuthGuard } from './auth/auth.guard';
import { PermissionInterceptor } from './auth/permission.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { TenantContextInterceptor } from './tenancy/tenant-context.interceptor';

import { validateEnv } from './config/env.validation';
import { AcademicsModule } from './academics/academics.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
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
    AuthModule,
    TenancyModule,
    IdentityModule,
    AcademicsModule,
    HealthModule,
  ],
  /**
   * The HTTP contract, bound to the module rather than to the bootstrap file.
   *
   * These were previously registered in main.ts with useGlobalInterceptors and
   * useGlobalFilters. That looks equivalent and is not: a global registered
   * there is not part of the module graph, so it protects only the one entry
   * point that remembers to add it. Anything else building an app from this
   * module gets none of it — a test, the worker, a future serverless handler.
   *
   * The gap was not theoretical. The conformance suite built an application the
   * ordinary way and a tenant-scoped route answered 200, because the tenant
   * interceptor simply was not there. Then, once that was fixed, the same suite
   * found the error envelope missing for the same reason.
   *
   * Order matters and is the registration order below:
   *
   * 1. AuthGuard establishes who is calling. Nest runs guards before every
   *    interceptor, so an unauthenticated request is refused before any of the
   *    work below happens.
   * 2. TenantContextInterceptor resolves which school the caller is acting in
   *    and opens the one request context.
   * 3. PermissionInterceptor decides whether that caller may use this route.
   *    It runs here rather than as a guard because guards run before every
   *    interceptor, so the role would not exist yet and would have to be
   *    resolved a second time.
   * 4. ResponseInterceptor wraps whatever comes back in the envelope.
   *
   * The guard and the interceptor are deliberately separate: the guard answers
   * "who", the interceptor answers "where", and only the interceptor opens a
   * context. Two places opening one would make it possible for one to be
   * skipped.
   *
   * The filter sits outside that ordering: it catches whatever any of them
   * throws, including the authentication and tenant rejections, so a refusal is
   * shaped like every other error rather than like a framework default.
   */
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: PermissionInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        // Strip anything the DTO does not declare, and reject rather than
        // ignore when a caller sends it. Blueprint rule 24: nothing
        // security-relevant is read from an unvalidated field, and silently
        // dropping an unknown one hides that a client is sending it.
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    },
  ],
})
export class AppModule {}
