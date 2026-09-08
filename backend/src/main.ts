import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';

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

  const prefix = process.env.API_PREFIX ?? 'api/v1';
  app.setGlobalPrefix(prefix);
  app.enableShutdownHooks();

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);

  Logger.log(`CyberSchola API listening on port ${port} under /${prefix}`, 'Bootstrap');
}

void bootstrap();
