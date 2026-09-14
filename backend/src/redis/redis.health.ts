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

/** Environments where a misconfigured local Redis warns instead of blocking. */
const LOCAL_ENVIRONMENTS = new Set(['development', 'test']);

/**
 * Opt-in acceptance of an unreadable eviction policy.
 *
 * Named here rather than inlined because it appears in the error message that
 * tells an operator how to set it, and the two must not drift apart.
 */
export const ALLOW_UNKNOWN_POLICY_FLAG = 'REDIS_ALLOW_UNKNOWN_EVICTION_POLICY';

/**
 * What we know about the instance's eviction policy.
 *
 * Three states, not two. `unknown` is deliberately not folded into `safe`:
 * being unable to read the policy is not evidence that the policy is correct,
 * and this check exists to protect quota and rate-limit counters whose failure
 * mode is silent and open. A boolean `safe` field used to live here and it
 * collapsed those two meanings, so it is gone rather than merely corrected;
 * a caller cannot reintroduce the bug by reading the wrong property.
 */
export type EvictionPolicyStatus = 'safe' | 'unsafe' | 'unknown';

export interface EvictionPolicyCheck {
  status: EvictionPolicyStatus;
  /** The policy as Redis reported it, or null when it could not be read. */
  policy: string | null;
  reason: string;
}

/**
 * Reads the instance's eviction policy and classifies it.
 *
 * Returns rather than throws, so the caller decides what each state means.
 * Managed Redis providers often disable `CONFIG GET` entirely, and a provider
 * we cannot interrogate is reported as `unknown`, not as safe.
 */
export async function checkEvictionPolicy(redis: Redis): Promise<EvictionPolicyCheck> {
  let policy: string | null = null;

  try {
    const result = await redis.config('GET', 'maxmemory-policy');
    const values = Array.isArray(result) ? result : [];
    policy = typeof values[1] === 'string' ? values[1] : null;
  } catch {
    return {
      status: 'unknown',
      policy: null,
      reason:
        'CONFIG GET is not permitted on this instance, so the eviction policy could not be read. ' +
        'Confirm with your provider that maxmemory-policy is noeviction.',
    };
  }

  if (policy === null) {
    return {
      status: 'unknown',
      policy: null,
      reason:
        'Redis answered CONFIG GET without reporting maxmemory-policy, so the eviction policy ' +
        'could not be determined.',
    };
  }

  if (EVICTING_POLICIES.has(policy)) {
    return {
      status: 'unsafe',
      policy,
      reason:
        `Redis is running maxmemory-policy "${policy}", which evicts keys under memory pressure. ` +
        'That silently deletes AI quota counters and rate limit counters, so those controls fail ' +
        'open with no error anywhere. Set maxmemory-policy to noeviction.',
    };
  }

  return { status: 'safe', policy, reason: `Eviction policy "${policy}" does not discard keys.` };
}

/** Reads the opt-in flag, treating a blank value as absent. */
function unknownPolicyAccepted(): boolean {
  return process.env[ALLOW_UNKNOWN_POLICY_FLAG]?.trim() === 'true';
}

/**
 * Applies the check at boot.
 *
 * The three states get three different answers:
 *
 * - safe: log and continue.
 * - unsafe: refuse to start outside development. We know the policy discards
 *   keys, so starting would ship a security control that fails open. This is
 *   never overridable, because there is nothing to decide: it is simply wrong.
 * - unknown: refuse to start outside development as well, because an
 *   unverified invariant is not a satisfied one. Unlike `unsafe` this one can
 *   be accepted deliberately by setting REDIS_ALLOW_UNKNOWN_EVICTION_POLICY,
 *   since some managed providers disable CONFIG GET and the policy is then
 *   guaranteed out of band instead. That makes the decision explicit, written
 *   down in the environment, and visible in a deployment review, rather than a
 *   silent default nobody chose.
 *
 * In development both non-safe states warn, so a developer running a stock
 * `redis:alpine` is not blocked by something that does not matter locally.
 */
export async function enforceEvictionPolicy(
  redis: Redis,
  nodeEnv: string,
  logger: Logger,
): Promise<void> {
  const result = await checkEvictionPolicy(redis);

  if (result.status === 'safe') {
    logger.log(`Redis eviction policy: ${result.reason}`);
    return;
  }

  if (LOCAL_ENVIRONMENTS.has(nodeEnv)) {
    logger.warn(`${result.reason} Allowed here because NODE_ENV is "${nodeEnv}".`);
    return;
  }

  if (result.status === 'unknown' && unknownPolicyAccepted()) {
    // Deliberately still a warning rather than an info line. The invariant is
    // accepted, not verified, and that distinction should stay visible in the
    // logs of every boot rather than disappearing once someone sets the flag.
    logger.warn(
      `${result.reason} Startup continued because ${ALLOW_UNKNOWN_POLICY_FLAG} is "true". ` +
        'The eviction policy is being guaranteed outside this application.',
    );
    return;
  }

  if (result.status === 'unknown') {
    throw new Error(
      `${result.reason} Refusing to start: an eviction policy that cannot be verified is not a ` +
        'policy that has been verified, and the counters this protects fail open when they are ' +
        `evicted. If your provider guarantees noeviction but blocks CONFIG GET, set ` +
        `${ALLOW_UNKNOWN_POLICY_FLAG}=true to record that decision explicitly.`,
    );
  }

  throw new Error(result.reason);
}
