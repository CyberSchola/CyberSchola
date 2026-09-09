import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

/**
 * Background worker entry point.
 *
 * The same modules as the API, booted without an HTTP listener. This is
 * decision 16A, and it exists now rather than when the first job arrives for
 * one reason: retrofitting it is expensive, establishing it is a file.
 *
 * Why the split matters. Tenant isolation protects data, not latency. If queue
 * processors ran inside the API they would share its event loop, and a
 * term-wide result export or a batch of PDF parsing would stall request
 * handling for every user in every tenant. The isolation we built does nothing
 * about a noisy neighbour on the event loop.
 *
 * Doing it now also forces a constraint that is easy to keep and painful to
 * add later: a job cannot read a request context, because there is no request.
 * Every payload has to carry its own tenant id, which is exactly the discipline
 * P1 will depend on.
 *
 * No queue processors are registered yet. BullMQ arrives with the first real
 * job in P8, where it can be tested against something that actually runs.
 * Wiring a queue library with zero queues would add dependencies and no safety.
 * For now this proves the two-process split boots, connects to Postgres and
 * Redis, and shuts down cleanly.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    // No HTTP server. createApplicationContext gives the dependency graph
    // without opening a port, so the worker cannot accidentally serve traffic
    // and get load balanced into a rotation it does not belong in.
    bufferLogs: false,
  });

  app.enableShutdownHooks();

  Logger.log('CyberSchola worker started. No queue processors registered yet.', 'Worker');

  // Kept alive by its Postgres and Redis connections. When processors arrive
  // they will hold the loop open in their own right.
  const shutdown = async (signal: string): Promise<void> => {
    Logger.log(`Received ${signal}, shutting the worker down`, 'Worker');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
