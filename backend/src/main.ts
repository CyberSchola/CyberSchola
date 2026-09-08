import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { setupSwagger } from './common/swagger/setup-swagger';
import { NodeEnv } from './config/env.validation';

/**
 * HTTP entry point.
 *
 * The queue workers deliberately do not run here. They boot the same modules
 * from worker.ts as a separate process (decision 16A), so a long export or a
 * document parse cannot stall request handling for every tenant on the box.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Express advertises itself by default. The banner tells an unauthenticated
  // caller what the API is built on, which is free reconnaissance and buys
  // nothing back.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  const isProduction = process.env.NODE_ENV === NodeEnv.Production;
  const prefix = process.env.API_PREFIX ?? 'api/v1';

  app.setGlobalPrefix(prefix);

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip anything the DTO does not declare, and reject rather than ignore
      // when a caller sends it. Blueprint rule 24: nothing security-relevant is
      // ever read from an unvalidated field, and silently dropping an unknown
      // field hides the fact that a client is sending one.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableShutdownHooks();

  const docsPath = setupSwagger(app, { isProduction });

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);

  Logger.log(`CyberSchola API listening on port ${port} under /${prefix}`, 'Bootstrap');
  Logger.log(
    docsPath ? `API documentation at /${docsPath}` : 'API documentation disabled in production',
    'Bootstrap',
  );
}

void bootstrap();
