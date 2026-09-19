import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AiChatRequestDto } from './ai-chat.dto';

async function errorsFor(payload: unknown) {
  const dto = plainToInstance(AiChatRequestDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('AiChatRequestDto', () => {
  it('accepts a valid message', async () => {
    expect(await errorsFor({ message: 'Explain photosynthesis' })).toHaveLength(0);
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('rejects %s', async (_label, message) => {
    expect(await errorsFor({ message })).not.toHaveLength(0);
  });

  it('rejects a message over 4000 characters', async () => {
    expect(await errorsFor({ message: 'a'.repeat(4001) })).not.toHaveLength(0);
  });

  it.each(['tenantId', 'userId', 'role', 'copilot'])('rejects an unexpected %s field', async (field) => {
    const errors = await errorsFor({ message: 'hi', [field]: 'anything' });
    expect(errors.some((e) => e.property === field)).toBe(true);
  });
});