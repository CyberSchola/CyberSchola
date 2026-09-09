import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

/**
 * Eviction policies that discard keys to make room.
 *
 * Any of these breaks the guarantee decision 15A depends on. `maxmemory-policy`
 * is a server-level setting, not per logical database, so separating cache from
 * quota counters into different DB indexes does not protect them: under memory
 * pressure Redis evicts by policy across the whole instance.
 *
 * The failure is silent and it fails open. A tenant's AI quota counter or a
 * user's password-reset rate limit simply disappears, and the next request sees
 * no counter and allows the action.
 */
const EVICTING_POLICIES = new Set([
  'volatile-lru',
  'allkeys-lru',
  'volatile-lfu',
  'allkeys-lfu',
  'volatile-random',
  'allkeys-random',
  'volatile-ttl',
]);

export interface EvictionPolicyCheck {
  policy: string | null;
  safe: boolean;
  reason: string;
}

/**
 * Reads the instance's eviction policy and says whether it is safe.
 *
 * Returns rather than throws, so the caller decides what a misconfiguration
 * means. Managed Redis providers often disable `CONFIG GET` entirely, and a
 * provider we cannot interrogate is not the same as one we know is wrong.
 */
export async function checkEvictionPolicy(redis: Redis): Promise<EvictionPolicyCheck> {
  let policy: string | null = null;

  try {
    const result = await redis.config('GET', 'maxmemory-policy');
    const values = Array.isArray(result) ? result : [];
    policy = typeof values[1] === 'string' ? values[1] : null;
  } catch {
    return {
      policy: null,
      safe: true,
      reason:
        'CONFIG GET is not permitted on this instance, so the eviction policy could not be read. ' +
        'Confirm with your provider that maxmemory-policy is noeviction.',
    };
  }

  if (policy === null) {
    return { policy: null, safe: true, reason: 'The eviction policy could not be determined.' };
  }

  if (EVICTING_POLICIES.has(policy)) {
    return {
      policy,
      safe: false,
      reason:
        `Redis is running maxmemory-policy "${policy}", which evicts keys under memory pressure. ` +
        'That silently deletes AI quota counters and rate limit counters, so those controls fail ' +
        'open with no error anywhere. Set maxmemory-policy to noeviction.',
    };
  }

  return { policy, safe: true, reason: `Eviction policy "${policy}" does not discard keys.` };
}

/**
 * Applies the check at boot.
 *
 * Refuses to start outside development, because shipping with an evicting
 * policy means a security control that fails open in production. In
 * development it warns, so a developer running a stock `redis:alpine` is not
 * blocked by something that does not matter locally.
 */
export async function enforceEvictionPolicy(
  redis: Redis,
  nodeEnv: string,
  logger: Logger,
): Promise<void> {
  const result = await checkEvictionPolicy(redis);

  if (result.safe) {
    logger.log(`Redis eviction policy: ${result.reason}`);
    return;
  }

  if (nodeEnv === 'development' || nodeEnv === 'test') {
    logger.warn(`${result.reason} Allowed here because NODE_ENV is "${nodeEnv}".`);
    return;
  }

  throw new Error(result.reason);
}
