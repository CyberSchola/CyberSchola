import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

import { CacheService } from '../src/redis/cache.service';
import { globalScope, tenantScope } from '../src/redis/cache-key';
import { checkEvictionPolicy } from '../src/redis/redis.health';
import { integrationRedisUrl } from './redis.setup';

/**
 * The cache, against a real Redis.
 *
 * A mocked client returns whatever it was told to, so it cannot show that a
 * key genuinely expires, that SCAN paginates the way we assume, or that the
 * instance is configured not to evict. Those are the guarantees decision 15A
 * rests on, and all three are properties of the server rather than of our code.
 */
describe('CacheService against real Redis', () => {
  let redis: Redis;
  let cache: CacheService;

  beforeAll(() => {
    redis = new Redis(integrationRedisUrl(), { maxRetriesPerRequest: 3 });
    cache = new CacheService(redis);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await redis.flushdb();
    await redis.quit();
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  describe('the eviction policy', () => {
    it('is not one that discards keys', async () => {
      // The reason this is asserted rather than assumed: under an evicting
      // policy Redis silently deletes AI quota and rate limit counters, and
      // those controls then fail open with no error anywhere. Testing against
      // an evicting instance would let that pass here and break in production.
      const result = await checkEvictionPolicy(redis);

      expect(result.safe).toBe(true);
    });

    it('is noeviction specifically, which is what the code expects', async () => {
      // ioredis types CONFIG GET as unknown, since the reply shape varies by
      // subcommand. Narrowed here rather than asserted blindly.
      const reply: unknown = await redis.config('GET', 'maxmemory-policy');
      const values = Array.isArray(reply) ? (reply as unknown[]) : [];

      expect(values[1]).toBe('noeviction');
    });
  });

  describe('every value really expires', () => {
    it('sets a TTL that Redis reports back', async () => {
      await cache.set(tenantScope('school-a'), 60, { total: 3 }, 'dashboard');

      const remaining = await cache.ttl(tenantScope('school-a'), 'dashboard');

      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(60);
    });

    it('leaves no key without an expiry', async () => {
      // -1 is Redis for "exists, never expires". With noeviction such a key
      // would live until someone deleted it by hand, and memory would climb
      // until writes began failing.
      await cache.set(tenantScope('school-a'), 60, 1, 'a');
      await cache.set(globalScope(), 60, 2, 'b');

      for (const key of await redis.keys('*')) {
        expect(await redis.ttl(key)).toBeGreaterThan(0);
      }
    });

    it('actually removes the value once the TTL elapses', async () => {
      await cache.set(tenantScope('school-a'), 1, { total: 3 }, 'short-lived');

      await expect(cache.get(tenantScope('school-a'), 'short-lived')).resolves.toEqual({
        total: 3,
      });

      await new Promise((resolve) => setTimeout(resolve, 1_500));

      await expect(cache.get(tenantScope('school-a'), 'short-lived')).resolves.toBeNull();
    });
  });

  describe('the tenant boundary', () => {
    it('does not let one school read another school of the same key', async () => {
      await cache.set(tenantScope('school-a'), 60, { owner: 'a' }, 'dashboard');
      await cache.set(tenantScope('school-b'), 60, { owner: 'b' }, 'dashboard');

      await expect(cache.get(tenantScope('school-a'), 'dashboard')).resolves.toEqual({
        owner: 'a',
      });
      await expect(cache.get(tenantScope('school-b'), 'dashboard')).resolves.toEqual({
        owner: 'b',
      });
    });

    it('stores them under genuinely different keys', async () => {
      await cache.set(tenantScope('school-a'), 60, 1, 'dashboard');
      await cache.set(tenantScope('school-b'), 60, 2, 'dashboard');

      expect((await redis.keys('*')).sort()).toEqual([
        'tenant:school-a:dashboard',
        'tenant:school-b:dashboard',
      ]);
    });

    it('clears one school without touching another', async () => {
      await cache.set(tenantScope('school-a'), 60, 1, 'dashboard');
      await cache.set(tenantScope('school-a'), 60, 2, 'students');
      await cache.set(tenantScope('school-b'), 60, 3, 'dashboard');

      const removed = await cache.clearScope(tenantScope('school-a'));

      expect(removed).toBe(2);
      await expect(cache.get(tenantScope('school-b'), 'dashboard')).resolves.toBe(3);
    });

    it('does not clear a tenant whose id merely shares a prefix', async () => {
      // "tenant:school-a" without the trailing separator would prefix-match
      // "tenant:school-ab", and clearing one school would partly clear another.
      await cache.set(tenantScope('school-a'), 60, 1, 'dashboard');
      await cache.set(tenantScope('school-ab'), 60, 2, 'dashboard');

      await cache.clearScope(tenantScope('school-a'));

      await expect(cache.get(tenantScope('school-ab'), 'dashboard')).resolves.toBe(2);
    });

    it('does not let a global clear remove tenant data', async () => {
      await cache.set(globalScope(), 60, 1, 'feature-flags');
      await cache.set(tenantScope('school-a'), 60, 2, 'dashboard');

      const removed = await cache.clearScope(globalScope());

      expect(removed).toBe(1);
      await expect(cache.get(tenantScope('school-a'), 'dashboard')).resolves.toBe(2);
    });
  });

  describe('clearScope at a size where SCAN actually paginates', () => {
    it('removes every key across multiple cursor passes', async () => {
      // One SCAN pass returns roughly COUNT keys, so a scope larger than the
      // batch is the only way to exercise the cursor loop. A single-pass test
      // would pass even if the loop were broken.
      const total = 1_200;

      for (let i = 0; i < total; i += 1) {
        await cache.set(tenantScope('big-school'), 60, i, 'item', String(i));
      }

      expect(await cache.clearScope(tenantScope('big-school'))).toBe(total);
      expect(await redis.keys('tenant:big-school:*')).toHaveLength(0);
    }, 60_000);
  });

  describe('round trips', () => {
    it.each([
      ['object', { a: 1, b: [2, 3], c: null }],
      ['array', [1, 'two', false]],
      ['string', 'hello'],
      ['number', 0],
      ['boolean', false],
      ['null', null],
      ['empty string', ''],
      ['empty array', []],
      ['empty object', {}],
    ])('preserves a %s exactly', async (_label, value) => {
      await cache.set(tenantScope('school-a'), 60, value, 'value');

      await expect(cache.get(tenantScope('school-a'), 'value')).resolves.toEqual(value);
    });

    it('treats a value written outside the service as a miss and clears it', async () => {
      await redis.set('tenant:school-a:hand-written', 'not json', 'EX', 60);

      await expect(cache.get(tenantScope('school-a'), 'hand-written')).resolves.toBeNull();
      expect(await redis.exists('tenant:school-a:hand-written')).toBe(0);
    });
  });
});
