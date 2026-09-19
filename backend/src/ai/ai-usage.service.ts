import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import { AiQuotaExceededException } from '../common/exceptions/app.exception';
import { REDIS_CLIENT } from '../redis/redis.constants';

const WINDOW_SECONDS = 600;
const MAX_REQUESTS_PER_WINDOW = 20;

/**
 * INCR, then EXPIRE whenever the key currently has no TTL — not only on the
 * first hit. Checking PTTL rather than trusting count === 1 means a key that
 * somehow lost its expiry (PERSIST, an operational mistake) self-heals on the
 * very next request instead of staying permanently unexpiring. Still one
 * atomic script: Redis runs it as a single uninterruptible step.
 */
const INCR_WITH_TTL_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

@Injectable()
export class AiUsageService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async checkAndRecord(tenantId: string, userId: string): Promise<void> {
    const key = `ai:usage:${tenantId}:${userId}`;
    const count = (await this.redis.eval(INCR_WITH_TTL_SCRIPT, 1, key, WINDOW_SECONDS)) as number;

    if (count > MAX_REQUESTS_PER_WINDOW) {
      throw new AiQuotaExceededException();
    }
  }
}
