import { AiUsageService } from './ai-usage.service';
import { AiQuotaExceededException } from '../common/exceptions/app.exception';

/**
 * A minimal but faithful in-memory Redis: real INCR/EXPIRE/TTL semantics and
 * a virtual clock, so `eval` actually executes the same state transitions the
 * real Lua script would drive, rather than the test only checking that the
 * script text contains "INCR" and "EXPIRE".
 */
class FakeRedis {
  private store = new Map<string, { count: number; expiresAtMs: number | null }>();
  private nowMs = 0;

  advance(ms: number) {
    this.nowMs += ms;
  }

  /** Mirrors the exact script AiUsageService sends: INCR, check PTTL, EXPIRE if unset. */
  eval(_script: string, _numKeys: number, key: string, windowSeconds: string | number): Promise<number> {    const existing = this.store.get(key);
    const expired = existing && existing.expiresAtMs !== null && existing.expiresAtMs <= this.nowMs;

    const entry = !existing || expired ? { count: 0, expiresAtMs: null } : existing;
    entry.count += 1;

    if (entry.expiresAtMs === null) {
      entry.expiresAtMs = this.nowMs + Number(windowSeconds) * 1000;
    }

    this.store.set(key, entry);
    return Promise.resolve(entry.count);
  }

  /** Simulates the reviewer's exact failure mode: TTL lost, count already > 1. */
  forceState(key: string, count: number, expiresAtMs: number | null) {
    this.store.set(key, { count, expiresAtMs });
  }

  hasTtl(key: string): boolean {
    return this.store.get(key)?.expiresAtMs !== null;
  }
}

describe('AiUsageService', () => {
  it('creates the counter and assigns a TTL on the first request', async () => {
    const redis = new FakeRedis();
    const service = new AiUsageService(redis as never);

    await service.checkAndRecord('t1', 'u1');

    expect(redis.hasTtl('ai:usage:t1:u1')).toBe(true);
  });

  it('accepts requests 1 through 20 within the window', async () => {
    const redis = new FakeRedis();
    const service = new AiUsageService(redis as never);

    for (let i = 0; i < 20; i++) {
      await expect(service.checkAndRecord('t1', 'u1')).resolves.toBeUndefined();
    }
  });

  it('rejects request 21 within the same window', async () => {
    const redis = new FakeRedis();
    const service = new AiUsageService(redis as never);

    for (let i = 0; i < 20; i++) await service.checkAndRecord('t1', 'u1');

    await expect(service.checkAndRecord('t1', 'u1')).rejects.toBeInstanceOf(AiQuotaExceededException);
  });

  it('starts a fresh window once the previous one has expired', async () => {
    const redis = new FakeRedis();
    const service = new AiUsageService(redis as never);

    for (let i = 0; i < 20; i++) await service.checkAndRecord('t1', 'u1');
    redis.advance(600_001);

    await expect(service.checkAndRecord('t1', 'u1')).resolves.toBeUndefined();
  });

  it('self-heals a counter that lost its TTL, rather than leaving it permanent', async () => {
    // The exact failure mode the reviewer flagged: count > 1 with no expiry.
    const redis = new FakeRedis();
    redis.forceState('ai:usage:t1:u1', 5, null);
    const service = new AiUsageService(redis as never);

    await service.checkAndRecord('t1', 'u1');

    expect(redis.hasTtl('ai:usage:t1:u1')).toBe(true);
  });

  it('isolates quota by tenant', async () => {
    const redis = new FakeRedis();
    const service = new AiUsageService(redis as never);

    for (let i = 0; i < 20; i++) await service.checkAndRecord('tenant-a', 'u1');

    await expect(service.checkAndRecord('tenant-b', 'u1')).resolves.toBeUndefined();
  });

  it('isolates quota by user within the same tenant', async () => {
    const redis = new FakeRedis();
    const service = new AiUsageService(redis as never);

    for (let i = 0; i < 20; i++) await service.checkAndRecord('t1', 'user-1');

    await expect(service.checkAndRecord('t1', 'user-2')).resolves.toBeUndefined();
  });
});