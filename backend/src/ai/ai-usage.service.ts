import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import { AiQuotaExceededException } from '../common/exceptions/app.exception';
import { REDIS_CLIENT } from '../redis/redis.constants';

const WINDOW_SECONDS = 600;
const MAX_REQUESTS_PER_WINDOW = 20;

/**
 * INCR and, on the first hit only, EXPIRE — run as one Lua script so Redis
 * executes both as a single uninterruptible step. This closes the gap in a
 * plain INCR-then-EXPIRE, where a crash between the two leaves a counter with
 * no TTL, permanently locking the key out.
 */
const INCR_WITH_TTL_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
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