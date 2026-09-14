import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
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

  // No global pipe, interceptor or filter is registered here.
  //
  // All four are bound in the module graph as APP_PIPE, APP_INTERCEPTOR and
  // APP_FILTER, so the worker and any future entry point inherit them instead
  // of each bootstrap file having to remember. Registering them here as well
  // was not a harmless duplicate: the response interceptor ran twice and every
  // successful response came back with a complete envelope nested inside its
  // own data field. main.ts now does only what is genuinely specific to
  // serving HTTP.

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
