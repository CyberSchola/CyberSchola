import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

import { CacheService } from './cache.service';
import { globalScope, tenantScope } from './cache-key';

function makeRedis(overrides: Record<string, unknown> = {}): Redis {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(60),
    scan: jest.fn().mockResolvedValue(['0', []]),
    ...overrides,
  } as unknown as Redis;
}

describe('CacheService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('set: a TTL is not optional', () => {
    it('writes with EX and the given expiry', async () => {
      const set = jest.fn().mockResolvedValue('OK');
      const service = new CacheService(makeRedis({ set }));

      await service.set(tenantScope('a'), 60, { total: 3 }, 'dashboard');

      expect(set).toHaveBeenCalledWith('tenant:a:dashboard', '{"total":3}', 'EX', 60);
    });

    it.each([0, -1, -60])('rejects a TTL of %s rather than writing forever', async (ttl) => {
      // Redis treats a non-positive expiry as an error or an immediate delete
      // depending on the command. Neither is what a caller passing 0 expects,
      // and quietly meaning "no expiry" is exactly the failure decision 15A
      // exists to prevent.
      const service = new CacheService(makeRedis());

      await expect(service.set(tenantScope('a'), ttl, {}, 'k')).rejects.toThrow(/positive whole/);
    });

    it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects a non-integer TTL of %s',
      async (ttl) => {
        const service = new CacheService(makeRedis());

        await expect(service.set(tenantScope('a'), ttl, {}, 'k')).rejects.toThrow(/positive whole/);
      },
    );

    it('rejects a TTL beyond a day, because that is state and not cache', async () => {
      const service = new CacheService(makeRedis());

      await expect(service.set(tenantScope('a'), 86_401, {}, 'k')).rejects.toThrow(/maximum/);
      await expect(service.set(tenantScope('a'), 86_400, {}, 'k')).resolves.toBeUndefined();
    });

    it('never writes when the TTL is rejected', async () => {
      const set = jest.fn();
      const service = new CacheService(makeRedis({ set }));

      await service.set(tenantScope('a'), 0, {}, 'k').catch(() => undefined);

      expect(set).not.toHaveBeenCalled();
    });

    it('refuses a key that could forge another namespace', async () => {
      const set = jest.fn();
      const service = new CacheService(makeRedis({ set }));

      await expect(service.set(tenantScope('a'), 60, {}, 'b:c')).rejects.toThrow(/Unsafe/);
      expect(set).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('returns null on a miss', async () => {
      const service = new CacheService(makeRedis({ get: jest.fn().mockResolvedValue(null) }));

      await expect(service.get(tenantScope('a'), 'k')).resolves.toBeNull();
    });

    it('parses a stored value', async () => {
      const service = new CacheService(
        makeRedis({ get: jest.fn().mockResolvedValue('{"total":3}') }),
      );

      await expect(service.get(tenantScope('a'), 'k')).resolves.toEqual({ total: 3 });
    });

    it('treats an unparseable entry as a miss and removes it', async () => {
      // A cache is not a source of truth. A corrupt entry should cost one
      // database read, not an error page.
      const del = jest.fn().mockResolvedValue(1);
      const service = new CacheService(
        makeRedis({ get: jest.fn().mockResolvedValue('{not json'), del }),
      );

      await expect(service.get(tenantScope('a'), 'k')).resolves.toBeNull();
      expect(del).toHaveBeenCalledWith('tenant:a:k');
    });

    it.each([
      ['null', null],
      ['0', 0],
      ['false', false],
      ['""', ''],
      ['[]', []],
    ])('round-trips the falsy value %s without turning it into a miss', async (raw, expected) => {
      const service = new CacheService(makeRedis({ get: jest.fn().mockResolvedValue(raw) }));

      await expect(service.get(tenantScope('a'), 'k')).resolves.toEqual(expected);
    });

    it('reads from the tenant namespace it was given', async () => {
      const get = jest.fn().mockResolvedValue(null);
      const service = new CacheService(makeRedis({ get }));

      await service.get(tenantScope('school-b'), 'dashboard');

      expect(get).toHaveBeenCalledWith('tenant:school-b:dashboard');
    });
  });

  describe('clearScope', () => {
    it('scans rather than using KEYS', async () => {
      // KEYS walks the whole keyspace in one blocking pass. On a shared
      // instance that stalls every other client, including the rate limiter.
      const scan = jest.fn().mockResolvedValue(['0', ['tenant:a:x']]);
      const redis = makeRedis({ scan });
      const service = new CacheService(redis);

      await service.clearScope(tenantScope('a'));

      expect(scan).toHaveBeenCalledWith('0', 'MATCH', 'tenant:a:*', 'COUNT', expect.any(Number));
      expect((redis as unknown as { keys?: unknown }).keys).toBeUndefined();
    });

    it('follows the cursor until the scan completes', async () => {
      const scan = jest
        .fn()
        .mockResolvedValueOnce(['17', ['tenant:a:x']])
        .mockResolvedValueOnce(['0', ['tenant:a:y']]);
      const del = jest.fn().mockResolvedValue(1);
      const service = new CacheService(makeRedis({ scan, del }));

      await expect(service.clearScope(tenantScope('a'))).resolves.toBe(2);
      expect(scan).toHaveBeenCalledTimes(2);
    });

    it('does not call del on an empty batch', async () => {
      // SCAN legitimately returns an empty slice with a non-zero cursor, and
      // `del()` with no arguments is a Redis error.
      const scan = jest.fn().mockResolvedValueOnce(['17', []]).mockResolvedValueOnce(['0', []]);
      const del = jest.fn();
      const service = new CacheService(makeRedis({ scan, del }));

      await expect(service.clearScope(tenantScope('a'))).resolves.toBe(0);
      expect(del).not.toHaveBeenCalled();
    });

    it('scopes the pattern so one tenant cannot clear another', async () => {
      const scan = jest.fn().mockResolvedValue(['0', []]);
      const service = new CacheService(makeRedis({ scan }));

      await service.clearScope(tenantScope('school-a'));

      expect(scan).toHaveBeenCalledWith(
        '0',
        'MATCH',
        'tenant:school-a:*',
        'COUNT',
        expect.any(Number),
      );
    });
  });

  describe('ttl', () => {
    it('reports the remaining seconds', async () => {
      const service = new CacheService(makeRedis({ ttl: jest.fn().mockResolvedValue(42) }));

      await expect(service.ttl(tenantScope('a'), 'k')).resolves.toBe(42);
    });

    it('returns null for a missing key', async () => {
      const service = new CacheService(makeRedis({ ttl: jest.fn().mockResolvedValue(-2) }));

      await expect(service.ttl(tenantScope('a'), 'k')).resolves.toBeNull();
    });

    it('logs an error for a key with no expiry, since this class cannot create one', async () => {
      // -1 means the key exists and never expires. CacheService cannot produce
      // that, so its presence means something wrote to Redis around this class,
      // which is the one thing decision 15A relies on not happening.
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const service = new CacheService(makeRedis({ ttl: jest.fn().mockResolvedValue(-1) }));

      await expect(service.ttl(tenantScope('a'), 'k')).resolves.toBeNull();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('no expiry'));
    });
  });

  it('works with the global scope as well as a tenant one', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const service = new CacheService(makeRedis({ set }));

    await service.set(globalScope(), 30, true, 'feature-flags');

    expect(set).toHaveBeenCalledWith('global:feature-flags', 'true', 'EX', 30);
  });
});
