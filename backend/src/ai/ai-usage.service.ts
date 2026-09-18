import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import { AiQuotaExceededException } from '../common/exceptions/app.exception';
import { REDIS_CLIENT } from '../redis/redis.constants';

const WINDOW_SECONDS = 600; // 10 minutes
const MAX_REQUESTS_PER_WINDOW = 20;

/**
 * Simple fixed-window rate limit for AI requests, backed by the existing
 * shared Redis client. Keyed by tenantId+userId from the trusted request
 * context, never by anything client-supplied.
 */
@Injectable()
export class AiUsageService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async checkAndRecord(tenantId: string, userId: string): Promise<void> {
    const key = `ai:usage:${tenantId}:${userId}`;
    const count = await this.redis.incr(key);

    if (count === 1) {
      await this.redis.expire(key, WINDOW_SECONDS);
    }

    if (count > MAX_REQUESTS_PER_WINDOW) {
      throw new AiQuotaExceededException();
    }
  }
}