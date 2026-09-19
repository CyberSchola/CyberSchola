import { Logger } from '@nestjs/common';
import type Groq from 'groq-sdk';

import { AiProviderException } from './ai-provider.exception';
import type { AiRequestContext } from './ai-provider.interface';
import { GroqProvider } from './groq.provider';

const CONTEXT: AiRequestContext = { tenantId: 't1', userId: 'u1', role: 'TEACHER', requestId: 'r1' };

function makeClient(create: jest.Mock): Groq {
  return { chat: { completions: { create } } } as unknown as Groq;
}

describe('GroqProvider', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the reply text on success', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'hello' } }] });
    const provider = new GroqProvider(makeClient(create));

    await expect(provider.generate({ message: 'hi', context: CONTEXT })).resolves.toEqual(
      expect.objectContaining({ message: 'hello' }),
    );
  });

  it('normalizes a raw SDK failure and never leaks it', async () => {
    const create = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:443'));
    const provider = new GroqProvider(makeClient(create));

    const error = await provider.generate({ message: 'hi', context: CONTEXT }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiProviderException);
    expect((error as AiProviderException).message).not.toContain('ECONNREFUSED');
    expect((error as AiProviderException).message).not.toContain('10.0.0.5');
  });

  it('normalizes an empty response the same way', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: null } }] });
    const provider = new GroqProvider(makeClient(create));

    await expect(provider.generate({ message: 'hi', context: CONTEXT })).rejects.toBeInstanceOf(
      AiProviderException,
    );
  });
});