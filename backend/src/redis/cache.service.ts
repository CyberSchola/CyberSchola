import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from './redis.constants';
import { buildCacheKey, cacheKeyPrefix, type CacheScope } from './cache-key';

/** Longest a cached value may live. */
const MAX_TTL_SECONDS = 24 * 60 * 60;

/** How many keys to ask for per SCAN pass when clearing a namespace. */
const SCAN_BATCH = 500;

/**
 * The only way application code touches Redis for caching.
 *
 * Two rules it exists to make unbreakable, both from decision 15A:
 *
 * 1. **Every cached value expires.** `set` takes a TTL as a required argument.
 *    There is no overload without one. Redis runs `noeviction`, so nothing is
 *    ever thrown out to make room; if a key could be written without a TTL it
 *    would live until someone deleted it by hand, and memory would climb until
 *    writes started failing.
 *
 * 2. **Every key is namespaced.** Keys are built from a `CacheScope`, so a
 *    tenant-owned value cannot be written under a bare key that another school
 *    could read back. The blueprint counts Redis as part of the security
 *    boundary, and this is where that boundary is a string rather than a
 *    database policy.
 *
 * Quota counters, rate limits and queues are deliberately *not* served by this
 * class. They must not expire, and mixing them in here would mean weakening
 * rule 1 for everyone.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Reads a cached value.
   *
   * A miss and a value that fails to parse are both treated as a miss. A cache
   * is not a source of truth, so a corrupt entry should cost a database read
   * rather than an error page.
   */
  async get<T>(scope: CacheScope, ...parts: readonly string[]): Promise<T | null> {
    const key = buildCacheKey(scope, ...parts);
    const raw = await this.redis.get(key);

    if (raw === null) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      this.logger.warn(`Discarding unparseable cache entry at ${key}`);
      await this.redis.del(key);
      return null;
    }
  }

  /**
   * Writes a cached value with a mandatory expiry.
   *
   * `ttlSeconds` is required and validated. Passing zero or a negative number
   * is rejected rather than quietly treated as "no expiry", which is how
   * `EXPIRE` semantics trip people up.
   */
  async set(
    scope: CacheScope,
    ttlSeconds: number,
    value: unknown,
    ...parts: readonly string[]
  ): Promise<void> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error(
        `Cache TTL must be a positive whole number of seconds, received ${String(ttlSeconds)}.`,
      );
    }

    if (ttlSeconds > MAX_TTL_SECONDS) {
      throw new Error(
        `Cache TTL of ${ttlSeconds}s exceeds the ${MAX_TTL_SECONDS}s maximum. ` +
          'Anything that needs to outlive a day is state, not cache, and belongs in Postgres.',
      );
    }

    const key = buildCacheKey(scope, ...parts);
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  /** Removes one key. Used after a write, so the next read rebuilds it. */
  async del(scope: CacheScope, ...parts: readonly string[]): Promise<void> {
    await this.redis.del(buildCacheKey(scope, ...parts));
  }

  /**
   * Removes every key in a scope.
   *
   * Uses SCAN rather than KEYS. `KEYS` walks the entire keyspace in one
   * blocking pass, and on a shared Redis that stalls every other client,
   * including the rate limiter. SCAN gives the same result in slices.
   *
   * Not atomic by design: keys written while this runs may survive. That is
   * acceptable for a cache, because the next write invalidates them again and
   * every key expires anyway.
   */
  async clearScope(scope: CacheScope): Promise<number> {
    const match = `${cacheKeyPrefix(scope)}*`;
    let cursor = '0';
    let removed = 0;

    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', match, 'COUNT', SCAN_BATCH);
      cursor = next;

      if (keys.length > 0) {
        removed += await this.redis.del(...keys);
      }
    } while (cursor !== '0');

    return removed;
  }

  /** Seconds until a key expires. Null when the key is gone. */
  async ttl(scope: CacheScope, ...parts: readonly string[]): Promise<number | null> {
    const remaining = await this.redis.ttl(buildCacheKey(scope, ...parts));

    // -2 means no such key. -1 means the key exists with no expiry, which this
    // class cannot produce; if it ever appears, something wrote around it.
    if (remaining === -2) {
      return null;
    }

    if (remaining === -1) {
      this.logger.error(
        `Cache key ${buildCacheKey(scope, ...parts)} has no expiry. ` +
          'Something wrote to Redis without going through CacheService.',
      );
      return null;
    }

    return remaining;
  }
}
