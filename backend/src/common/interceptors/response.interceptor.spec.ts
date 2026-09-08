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

  // Requested on review: the payload shapes a handler can realistically return.
  // This contract is the boundary the web application codes against, so each
  // case is pinned rather than left to inference from the two cases above.
  describe('payload shapes', () => {
    it('passes a populated array through unchanged', async () => {
      const rows = [{ id: 'a' }, { id: 'b' }];
      const result = await run(rows);

      expect(result.data).toEqual(rows);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('does not collapse a single-element array into the element', async () => {
      await expect(run([{ id: 'a' }])).resolves.toMatchObject({ data: [{ id: 'a' }] });
    });

    it('preserves an empty object rather than treating it as absent', async () => {
      const result = await run({});

      expect(result.data).toEqual({});
      expect(result.data).not.toBeNull();
    });

    it('preserves nested structures, including nested nulls', async () => {
      const payload = { a: { b: [1, { c: null }] }, d: null };

      await expect(run(payload)).resolves.toMatchObject({ data: payload });
    });

    it('survives a JSON round trip unchanged, which is what the client receives', async () => {
      const payload = { id: 'a', count: 0, active: false, note: '', tags: [] };
      const result = await run(payload);

      expect(JSON.parse(JSON.stringify(result))).toEqual({
        statusCode: 200,
        code: SUCCESS_CODE,
        message: SYSTEM_MESSAGES.SUCCESS,
        data: payload,
      });
    });

    it('keeps data as an explicit null in the serialised body, not a dropped key', async () => {
      // JSON.stringify drops undefined but keeps null. If `data` were left
      // undefined the key would vanish from the wire and the client's type
      // would be wrong.
      const serialised = JSON.stringify(await run(undefined));

      expect(serialised).toContain('"data":null');
    });

    it('reports a 204 status faithfully rather than forcing 200', async () => {
      await expect(run(null, 204)).resolves.toMatchObject({ statusCode: 204, data: null });
    });
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
