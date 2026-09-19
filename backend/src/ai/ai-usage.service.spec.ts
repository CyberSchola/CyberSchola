import { AiUsageService } from './ai-usage.service';
import { AiQuotaExceededException } from '../common/exceptions/app.exception';

function makeRedis(counts: number[]) {
  let i = 0;
  const eval_ = jest.fn().mockImplementation(() => Promise.resolve(counts[i++] ?? counts[counts.length - 1]));
  return { eval: eval_ } as any;
}

describe('AiUsageService', () => {
  it('accepts requests 1 through 20', async () => {
    const redis = makeRedis(Array.from({ length: 20 }, (_, n) => n + 1));
    const service = new AiUsageService(redis);
    for (let n = 0; n < 20; n++) {
      await expect(service.checkAndRecord('t1', 'u1')).resolves.toBeUndefined();
    }
  });

  it('rejects request 21', async () => {
    const redis = makeRedis([21]);
    const service = new AiUsageService(redis);
    await expect(service.checkAndRecord('t1', 'u1')).rejects.toBeInstanceOf(AiQuotaExceededException);
  });

  it('uses one atomic script rather than separate INCR/EXPIRE calls', async () => {
    const redis = makeRedis([1]);
    const service = new AiUsageService(redis);
    await service.checkAndRecord('t1', 'u1');
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval.mock.calls[0][0]).toContain('INCR');
    expect(redis.eval.mock.calls[0][0]).toContain('EXPIRE');
  });

  it('scopes the key by tenant and user, isolating both', async () => {
    const redis = makeRedis([1]);
    const service = new AiUsageService(redis);
    await service.checkAndRecord('tenant-a', 'user-1');
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'ai:usage:tenant-a:user-1', 600);

    await service.checkAndRecord('tenant-b', 'user-1');
    expect(redis.eval).toHaveBeenLastCalledWith(expect.any(String), 1, 'ai:usage:tenant-b:user-1', 600);

    await service.checkAndRecord('tenant-a', 'user-2');
    expect(redis.eval).toHaveBeenLastCalledWith(expect.any(String), 1, 'ai:usage:tenant-a:user-2', 600);
  });
});