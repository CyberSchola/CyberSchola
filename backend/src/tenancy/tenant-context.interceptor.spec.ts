import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import { UnauthenticatedException } from '../common/exceptions/app.exception';
import { getRequestContext } from './request-context';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import type { TenantResolver } from './tenant-resolver';

const TENANT = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function makeContext(headers: Record<string, string> = {}, type = 'http'): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

interface SpiedResolver extends TenantResolver {
  /** Held separately so assertions never read the method off the object,
   *  which is what @typescript-eslint/unbound-method exists to prevent. */
  calls: jest.Mock;
}

function resolverReturning(value: string | null): SpiedResolver {
  const calls = jest.fn().mockResolvedValue(value);
  return { resolve: (request) => calls(request) as Promise<string | null>, calls };
}

describe('TenantContextInterceptor', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
  });

  function build(resolver: TenantResolver): TenantContextInterceptor {
    return new TenantContextInterceptor(reflector, resolver);
  }

  const nextReturning = <T>(value: T): CallHandler<T> => ({ handle: () => of(value) });

  describe('when no tenant can be resolved', () => {
    it('rejects the request rather than letting the handler run', async () => {
      // The default state until authentication lands. An endpoint added before
      // then must not serve school data by accident.
      const handler = jest.fn();
      const interceptor = build(resolverReturning(null));

      await expect(
        firstValueFrom(interceptor.intercept(makeContext(), { handle: handler })),
      ).rejects.toBeInstanceOf(UnauthenticatedException);

      expect(handler).not.toHaveBeenCalled();
    });

    it('reports 401 rather than 403', async () => {
      // Not knowing who is calling is an authentication problem. A 403 would
      // claim we know who they are and are refusing them, which is a stronger
      // statement than we can support.
      const interceptor = build(resolverReturning(null));

      const error = await firstValueFrom(
        interceptor.intercept(makeContext(), nextReturning(null)),
      ).catch((thrown: unknown) => thrown);

      expect((error as UnauthenticatedException).getStatus()).toBe(401);
    });
  });

  describe('when the route is marked @TenantOptional()', () => {
    it('lets the request through without resolving anything', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const resolver = resolverReturning(null);
      const interceptor = build(resolver);

      await expect(
        firstValueFrom(interceptor.intercept(makeContext(), nextReturning('ok'))),
      ).resolves.toBe('ok');

      // Not merely allowed through: the resolver is not even consulted, so a
      // health probe costs no lookup.
      expect(resolver.calls).not.toHaveBeenCalled();
    });

    it('leaves no tenant in scope, so a handler cannot quietly use one', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const interceptor = build(resolverReturning(TENANT));

      let seen: unknown = 'unset';
      await firstValueFrom(
        interceptor.intercept(makeContext(), {
          handle: () => {
            seen = getRequestContext();
            return of(null);
          },
        }),
      );

      expect(seen).toBeUndefined();
    });
  });

  describe('when a tenant resolves', () => {
    it('puts it in scope for the handler', async () => {
      const interceptor = build(resolverReturning(TENANT));

      let seen: string | undefined;
      await firstValueFrom(
        interceptor.intercept(makeContext(), {
          handle: () => {
            seen = getRequestContext()?.tenantId;
            return of(null);
          },
        }),
      );

      expect(seen).toBe(TENANT);
    });

    it('does not leave the context in scope afterwards', async () => {
      const interceptor = build(resolverReturning(TENANT));

      await firstValueFrom(interceptor.intercept(makeContext(), nextReturning(null)));

      expect(getRequestContext()).toBeUndefined();
    });

    it('carries an incoming request id so logs correlate', async () => {
      const interceptor = build(resolverReturning(TENANT));

      let seen: string | undefined;
      await firstValueFrom(
        interceptor.intercept(makeContext({ 'x-request-id': 'req-123' }), {
          handle: () => {
            seen = getRequestContext()?.requestId;
            return of(null);
          },
        }),
      );

      expect(seen).toBe('req-123');
    });

    it('generates a request id when the caller sends none', async () => {
      const interceptor = build(resolverReturning(TENANT));

      let seen: string | undefined;
      await firstValueFrom(
        interceptor.intercept(makeContext(), {
          handle: () => {
            seen = getRequestContext()?.requestId;
            return of(null);
          },
        }),
      );

      expect(seen).toEqual(expect.any(String));
      expect(seen).not.toBe('');
    });

    it('keeps two concurrent requests in separate contexts', async () => {
      // The failure this guards against is the worst kind: request A reading
      // request B's tenant under load, intermittently, with nothing in the
      // logs to explain it.
      const other = '11111111-2222-4333-8444-555555555555';
      const seen: string[] = [];

      const run = (tenant: string) =>
        firstValueFrom(
          build(resolverReturning(tenant)).intercept(makeContext(), {
            handle: () => {
              seen.push(getRequestContext()?.tenantId ?? 'none');
              return of(null);
            },
          }),
        );

      await Promise.all([run(TENANT), run(other), run(TENANT)]);

      expect(seen.sort()).toEqual([other, TENANT, TENANT].sort());
    });
  });

  it('passes non-HTTP contexts through untouched', async () => {
    // A queue or RPC handler has no request to resolve from. Without this the
    // interceptor would reject every future job.
    const resolver = resolverReturning(null);
    const interceptor = build(resolver);

    await expect(
      firstValueFrom(interceptor.intercept(makeContext({}, 'rpc'), nextReturning('done'))),
    ).resolves.toBe('done');
    expect(resolver.calls).not.toHaveBeenCalled();
  });
});
