import { DECORATORS } from '@nestjs/swagger';

import { Public, PUBLIC_KEY } from './public.decorator';

class Probe {
  @Public()
  open(): void {}

  guarded(): void {}
}

/** The handler function itself, where Nest's decorators store their metadata. */
const handler = (name: keyof Probe): object =>
  Object.getOwnPropertyDescriptor(Probe.prototype, name)?.value as object;

describe('Public', () => {
  it('marks the handler for the guard', () => {
    expect(Reflect.getMetadata(PUBLIC_KEY, handler('open'))).toBe(true);
  });

  // The document applies the bearer requirement to every operation. An empty
  // list here is what tells OpenAPI, and Swagger UI, that this one needs none.
  it('clears the OpenAPI security requirement on the same handler', () => {
    expect(Reflect.getMetadata(DECORATORS.API_SECURITY, handler('open'))).toEqual([]);
  });

  it('leaves a handler without it untouched', () => {
    expect(Reflect.getMetadata(PUBLIC_KEY, handler('guarded'))).toBeUndefined();
    expect(Reflect.getMetadata(DECORATORS.API_SECURITY, handler('guarded'))).toBeUndefined();
  });
});
