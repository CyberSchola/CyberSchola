import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

import {
  ALLOW_UNKNOWN_POLICY_FLAG,
  checkEvictionPolicy,
  enforceEvictionPolicy,
} from './redis.health';

function redisWithPolicy(policy: string): Redis {
  return { config: jest.fn().mockResolvedValue(['maxmemory-policy', policy]) } as unknown as Redis;
}

/** An instance that refuses CONFIG GET, as managed providers commonly do. */
function redisRefusingConfig(): Redis {
  return {
    config: jest.fn().mockRejectedValue(new Error('unknown command CONFIG')),
  } as unknown as Redis;
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
  ])('reports %s as unsafe, because it discards keys under memory pressure', async (policy) => {
    const result = await checkEvictionPolicy(redisWithPolicy(policy));

    expect(result.status).toBe('unsafe');
    expect(result.policy).toBe(policy);
  });

  it('reports noeviction as safe', async () => {
    const result = await checkEvictionPolicy(redisWithPolicy('noeviction'));

    expect(result.status).toBe('safe');
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

  describe('the three states are genuinely distinct', () => {
    it('reports an unreadable policy as unknown, not as safe', async () => {
      // The whole point of the change: not being able to look is not the same
      // as having looked and found it correct. Collapsing those two into one
      // boolean is what made the check claim a guarantee it did not have.
      const result = await checkEvictionPolicy(redisRefusingConfig());

      expect(result.status).toBe('unknown');
      expect(result.policy).toBeNull();
      expect(result.reason).toMatch(/not permitted/i);
    });

    it('reports an unreadable policy as unknown, not as unsafe either', async () => {
      // Equally important in the other direction. Treating unreadable as unsafe
      // would be a different lie, and would tell an operator to change a
      // setting we never actually read.
      const result = await checkEvictionPolicy(redisRefusingConfig());

      expect(result.status).not.toBe('unsafe');
    });

    it('reports a malformed CONFIG reply as unknown rather than throwing', async () => {
      const redis = { config: jest.fn().mockResolvedValue('nonsense') };

      await expect(checkEvictionPolicy(redis as unknown as Redis)).resolves.toMatchObject({
        status: 'unknown',
        policy: null,
      });
    });

    it('never returns a state outside the three', async () => {
      const results = await Promise.all([
        checkEvictionPolicy(redisWithPolicy('noeviction')),
        checkEvictionPolicy(redisWithPolicy('allkeys-lru')),
        checkEvictionPolicy(redisRefusingConfig()),
      ]);

      expect(results.map((result) => result.status)).toEqual(['safe', 'unsafe', 'unknown']);
    });
  });
});

describe('enforceEvictionPolicy', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('test');
    jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    delete process.env[ALLOW_UNKNOWN_POLICY_FLAG];
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env[ALLOW_UNKNOWN_POLICY_FLAG];
  });

  describe('a known-unsafe policy', () => {
    it.each(['production', 'staging'])('refuses to boot in %s', async (env) => {
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

    it('cannot be overridden by the unknown-policy flag', async () => {
      // The flag accepts an unverified invariant. It must never wave through a
      // policy we have read and know to be wrong, or it becomes a switch for
      // disabling the check outright.
      process.env[ALLOW_UNKNOWN_POLICY_FLAG] = 'true';

      await expect(
        enforceEvictionPolicy(redisWithPolicy('allkeys-lru'), 'production', logger),
      ).rejects.toThrow(/noeviction/);
    });
  });

  describe('an unknown policy', () => {
    it.each(['production', 'staging'])('refuses to boot in %s by default', async (env) => {
      // The behaviour this change exists to define. An invariant we could not
      // verify is not an invariant we have, and the counters it protects fail
      // open when they are evicted, so the default is to stop.
      await expect(enforceEvictionPolicy(redisRefusingConfig(), env, logger)).rejects.toThrow(
        /cannot be verified/i,
      );
    });

    it('tells the operator exactly how to accept it deliberately', async () => {
      // A refusal with no route forward gets solved by deleting the check.
      await expect(
        enforceEvictionPolicy(redisRefusingConfig(), 'production', logger),
      ).rejects.toThrow(new RegExp(ALLOW_UNKNOWN_POLICY_FLAG));
    });

    it('continues when the flag explicitly accepts it', async () => {
      process.env[ALLOW_UNKNOWN_POLICY_FLAG] = 'true';

      await expect(
        enforceEvictionPolicy(redisRefusingConfig(), 'production', logger),
      ).resolves.toBeUndefined();
    });

    it('still warns when accepted, so the gap stays visible in every boot', async () => {
      // Accepted is not verified. Logged at info level it would vanish into
      // startup noise and nobody would revisit the decision.
      process.env[ALLOW_UNKNOWN_POLICY_FLAG] = 'true';
      const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

      await enforceEvictionPolicy(redisRefusingConfig(), 'production', logger);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(ALLOW_UNKNOWN_POLICY_FLAG));
    });

    it.each(['1', 'yes', 'TRUE', 'false', ' '])(
      'does not accept %p as the flag value, only the exact string true',
      async (value) => {
        // The DATABASE_SSL lesson: a truthy-looking value that is not the one
        // we check for must not silently pass, and a blank must not either.
        process.env[ALLOW_UNKNOWN_POLICY_FLAG] = value;

        await expect(
          enforceEvictionPolicy(redisRefusingConfig(), 'production', logger),
        ).rejects.toThrow(/cannot be verified/i);
      },
    );

    it.each(['development', 'test'])('warns but continues in %s without the flag', async (env) => {
      const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

      await expect(
        enforceEvictionPolicy(redisRefusingConfig(), env, logger),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    });
  });

  it('boots quietly on a safe policy, in every environment', async () => {
    for (const env of ['development', 'test', 'staging', 'production']) {
      await expect(
        enforceEvictionPolicy(redisWithPolicy('noeviction'), env, logger),
      ).resolves.toBeUndefined();
    }
  });
});
