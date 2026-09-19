import { AiService } from './ai.service';
import { AiUsageService } from './ai-usage.service';
import { AiQuotaExceededException } from '../common/exceptions/app.exception';
import type { AiProvider, AiRequestContext } from './ai-provider.interface';

const CONTEXT: AiRequestContext = { tenantId: 't1', userId: 'u1', role: 'TEACHER', requestId: 'r1' };

describe('AiService (gateway boundary)', () => {
  it('checks quota before calling the provider', async () => {
    const calls: string[] = [];
    const usage = { checkAndRecord: jest.fn().mockImplementation(async () => { calls.push('usage'); }) } as unknown as AiUsageService;
    const provider: AiProvider = { generate: jest.fn().mockImplementation(async () => { calls.push('provider'); return { message: 'ok' }; }) };

    await new AiService(provider, usage).chat(CONTEXT, 'hi');

    expect(calls).toEqual(['usage', 'provider']);
  });

  it('never calls the provider when quota is exceeded', async () => {
    const usage = { checkAndRecord: jest.fn().mockRejectedValue(new AiQuotaExceededException()) } as unknown as AiUsageService;
    const provider: AiProvider = { generate: jest.fn() };

    await expect(new AiService(provider, usage).chat(CONTEXT, 'hi')).rejects.toBeInstanceOf(AiQuotaExceededException);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('passes the trusted context to the provider, not client input', async () => {
    const usage = { checkAndRecord: jest.fn().mockResolvedValue(undefined) } as unknown as AiUsageService;
    const generate = jest.fn().mockResolvedValue({ message: 'ok' });
    const provider: AiProvider = { generate };

    await new AiService(provider, usage).chat(CONTEXT, 'hi');

    expect(generate).toHaveBeenCalledWith({ message: 'hi', context: CONTEXT });
  });
});