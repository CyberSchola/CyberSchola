import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import { SYSTEM_MESSAGES } from '../../constants/system.messages';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';
import { SUCCESS_CODE } from '../enums/error-code.enum';
import { ResponseInterceptor } from './response.interceptor';

function makeContext(statusCode = 200): ExecutionContext {
  return {
    switchToHttp: () => ({ getResponse: () => ({ statusCode }) }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function makeHandler<T>(value: T): CallHandler<T> {
  return { handle: () => of(value) };
}

describe('ResponseInterceptor', () => {
  let reflector: Reflector;
  let interceptor: ResponseInterceptor<unknown>;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new ResponseInterceptor(reflector);
  });

  async function run<T>(value: T, statusCode = 200) {
    return firstValueFrom(
      await Promise.resolve(interceptor.intercept(makeContext(statusCode), makeHandler(value))),
    );
  }

  it('wraps the payload in the envelope', async () => {
    await expect(run({ id: 'abc' })).resolves.toEqual({
      statusCode: 200,
      code: SUCCESS_CODE,
      message: SYSTEM_MESSAGES.SUCCESS,
      data: { id: 'abc' },
    });
  });

  it('reports the status the handler actually set, not a hardcoded 200', async () => {
    await expect(run({ id: 'abc' }, 201)).resolves.toMatchObject({ statusCode: 201 });
  });

  it('uses the message from @ResponseMessage when a handler sets one', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(SYSTEM_MESSAGES.HEALTH.LIVE);

    await expect(run(null)).resolves.toMatchObject({ message: SYSTEM_MESSAGES.HEALTH.LIVE });
  });

  it('reads the message from the documented metadata key', () => {
    const spy = jest.spyOn(reflector, 'getAllAndOverride');

    void interceptor.intercept(makeContext(), makeHandler(null));

    expect(spy).toHaveBeenCalledWith(RESPONSE_MESSAGE_KEY, expect.any(Array));
  });

  it('turns an absent return value into an explicit null, never a missing key', async () => {
    for (const empty of [undefined, null]) {
      const result = await run(empty);

      expect(result).toHaveProperty('data');
      expect(result.data).toBeNull();
    }
  });

  it('preserves falsy payloads rather than treating them as absent', async () => {
    // `?? null` and `|| null` differ here, and getting it wrong would silently
    // turn a legitimate 0, empty string or false into null.
    await expect(run(0)).resolves.toMatchObject({ data: 0 });
    await expect(run('')).resolves.toMatchObject({ data: '' });
    await expect(run(false)).resolves.toMatchObject({ data: false });
    await expect(run([])).resolves.toMatchObject({ data: [] });
  });

  it('always emits exactly the four envelope keys', async () => {
    const result = await run({ anything: true });

    expect(Object.keys(result).sort()).toEqual(['code', 'data', 'message', 'statusCode']);
  });

  it('does not double-wrap a payload that already looks like an envelope', async () => {
    // A handler returning something envelope-shaped is a mistake, but it must
    // land in `data` rather than being merged into the outer object.
    const looksLikeEnvelope = { statusCode: 200, code: SUCCESS_CODE, message: 'x', data: null };
    const result = await run(looksLikeEnvelope);

    expect(result.data).toEqual(looksLikeEnvelope);
    expect(result.message).toBe(SYSTEM_MESSAGES.SUCCESS);
  });
});
