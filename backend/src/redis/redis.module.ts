import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

import { CacheService } from './cache.service';
import { REDIS_CLIENT } from './redis.constants';
import { enforceEvictionPolicy } from './redis.health';

const logger = new Logger('RedisModule');

function redisUrl(): string {
  const url = process.env.REDIS_URL?.trim();

  if (!url) {
    throw new Error('REDIS_URL is required. See .env.example.');
  }

  return url;
}

/**
 * Shared Redis connection.
 *
 * One client for the whole process. ioredis multiplexes commands over a single
 * connection, so a client per module would waste connections against a shared
 * instance without making anything faster.
 *
 * Failure contract: Redis is required infrastructure. The application does not
 * start without it, does not serve traffic while it is unavailable (readiness
 * fails, see ReadinessService), and does not silently substitute the database
 * for it. That is a deliberate choice rather than an omission, because the
 * state that will live here next is AI quota and rate-limit counters, and a
 * cache that quietly falls back is a quota that quietly stops counting.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: async (): Promise<Redis> => {
        const client = new Redis(redisUrl(), {
          // Fail a command rather than queue it forever when Redis is gone.
          // The default retries indefinitely, so a request that touches Redis
          // hangs until the client gives up, turning an outage into a pile of
          // stuck requests holding connections. Failing fast lets the request
          // return an error and lets readiness report the truth.
          maxRetriesPerRequest: 3,
          enableOfflineQueue: false,
          connectTimeout: 5_000,
          lazyConnect: true,
          retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
        });

        client.on('error', (error: Error) => {
          // Logged, not thrown, and this is not a fallback story.
          //
          // Redis is required infrastructure here, not an optional accelerator:
          // REDIS_URL is mandatory, the connection opens during startup, and
          // readiness returns 503 while it is down. Nothing degrades to
          // Postgres, and CacheService does not catch connection errors to
          // read through to the database.
          //
          // The reason this handler does not rethrow is narrower. ioredis emits
          // `error` on every reconnection attempt, so throwing would turn a
          // transient blip into a dead process even though the client recovers
          // on its own. Readiness has already taken this instance out of the
          // load balancer, so the correct response is to record it and let the
          // client reconnect.
          logger.error(`Redis connection error: ${error.message}`);
        });

        await client.connect();

        await enforceEvictionPolicy(client, process.env.NODE_ENV ?? 'development', logger);

        return client;
      },
    },
    CacheService,
  ],
  exports: [REDIS_CLIENT, CacheService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Closes the connection on shutdown.
   *
   * `quit` rather than `disconnect`, so in-flight commands are allowed to
   * finish instead of being severed mid-write. Without this the process keeps
   * an open socket and refuses to exit, which turns a rolling deploy into a
   * wait for the orchestrator's kill timeout.
   */
  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'end') {
      return;
    }

    try {
      await this.redis.quit();
    } catch (error) {
      // Already gone, or the connection died first. Nothing to salvage at
      // shutdown, and throwing here would mask the real reason for the stop.
      logger.warn(
        `Redis did not close cleanly: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
