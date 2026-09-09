import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

import { checkEvictionPolicy, enforceEvictionPolicy } from './redis.health';

function redisWithPolicy(policy: string): Redis {
  return { config: jest.fn().mockResolvedValue(['maxmemory-policy', policy]) } as unknown as Redis;
}

describe('checkEvictionPolicy', () => {
  it.each([
    'allkeys-lru',
    'volatile-lru',
    'allkeys-lfu',
    'volatile-lfu',
    'allkeys-random',
    'volatile-random',
    'volatile-ttl',
  ])('rejects %s, which discards keys under memory pressure', async (policy) => {
    const result = await checkEvictionPolicy(redisWithPolicy(policy));

    expect(result.safe).toBe(false);
    expect(result.policy).toBe(policy);
  });

  it('accepts noeviction', async () => {
    const result = await checkEvictionPolicy(redisWithPolicy('noeviction'));

    expect(result.safe).toBe(true);
    expect(result.policy).toBe('noeviction');
  });

  it('explains the consequence, not just the rule', async () => {
    // Someone hitting this needs to know why it matters, or they will "fix" it
    // by ignoring the check.
    const { reason } = await checkEvictionPolicy(redisWithPolicy('allkeys-lru'));

    expect(reason).toMatch(/quota/i);
    expect(reason).toMatch(/rate limit/i);
    expect(reason).toMatch(/fail open/i);
  });

  it('treats an unreadable policy as unknown rather than unsafe', async () => {
    // Managed providers commonly disable CONFIG GET. Not being able to look is
    // different from knowing it is wrong, and refusing to boot on a provider we
    // cannot interrogate would be wrong.
    const redis = { config: jest.fn().mockRejectedValue(new Error('unknown command')) };
    const result = await checkEvictionPolicy(redis as unknown as Redis);

    expect(result.safe).toBe(true);
    expect(result.policy).toBeNull();
    expect(result.reason).toMatch(/not permitted/i);
  });

  it('handles a malformed CONFIG reply without throwing', async () => {
    const redis = { config: jest.fn().mockResolvedValue('nonsense') };

    await expect(checkEvictionPolicy(redis as unknown as Redis)).resolves.toMatchObject({
      safe: true,
      policy: null,
    });
  });
});

describe('enforceEvictionPolicy', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('test');
    jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each(['production', 'staging'])('refuses to boot in %s on an evicting policy', async (env) => {
    // Shipping with an evicting policy means a security control that fails
    // open. Better to refuse the deploy than to serve traffic without quotas.
    await expect(
      enforceEvictionPolicy(redisWithPolicy('allkeys-lru'), env, logger),
    ).rejects.toThrow(/noeviction/);
  });

  it.each(['development', 'test'])('warns but continues in %s', async (env) => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(
      enforceEvictionPolicy(redisWithPolicy('allkeys-lru'), env, logger),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('says which environment allowed it, so the warning is actionable', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await enforceEvictionPolicy(redisWithPolicy('allkeys-lru'), 'development', logger);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('development'));
  });

  it('boots quietly on a safe policy, in every environment', async () => {
    for (const env of ['development', 'test', 'staging', 'production']) {
      await expect(
        enforceEvictionPolicy(redisWithPolicy('noeviction'), env, logger),
      ).resolves.toBeUndefined();
    }
  });

  it('does not block production when the policy simply cannot be read', async () => {
    const redis = { config: jest.fn().mockRejectedValue(new Error('CONFIG disabled')) };

    await expect(
      enforceEvictionPolicy(redis as unknown as Redis, 'production', logger),
    ).resolves.toBeUndefined();
  });
});
