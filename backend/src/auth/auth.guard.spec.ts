import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UnauthenticatedException } from '../common/exceptions/app.exception';
import { AuthGuard, VERIFIED_IDENTITY } from './auth.guard';
import type { SupabaseTokenVerifier, VerifiedIdentity } from './token-verifier';

const USER = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

interface Probe {
  request: Record<string | symbol, unknown>;
  context: ExecutionContext;
}

function makeContext(headers: Record<string, string> = {}, type = 'http'): Probe {
  const request: Record<string | symbol, unknown> = { headers };

  return {
    request,
    context: {
      getType: () => type,
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    } as unknown as ExecutionContext,
  };
}

interface SpiedVerifier {
  verifier: SupabaseTokenVerifier;
  /** Held apart so assertions never read the method off the object. */
  calls: jest.Mock;
}

function verifierReturning(identity: VerifiedIdentity | null): SpiedVerifier {
  const calls = jest.fn().mockResolvedValue(identity);

  return {
    verifier: {
      verify: (token: string) => calls(token) as Promise<VerifiedIdentity | null>,
    } as unknown as SupabaseTokenVerifier,
    calls,
  };
}

describe('AuthGuard', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
  });

  const build = (verifier: SupabaseTokenVerifier) => new AuthGuard(reflector, verifier);

  describe('on a protected route', () => {
    it('rejects a request with no Authorization header', async () => {
      const { verifier } = verifierReturning(null);
      const { context } = makeContext();

      await expect(build(verifier).canActivate(context)).rejects.toBeInstanceOf(
        UnauthenticatedException,
      );
    });

    it('does not even call the verifier when no token is present', async () => {
      // A missing token is not a verification failure, and paying for a JWKS
      // fetch on an unauthenticated probe would be free work for an attacker.
      const { verifier, calls } = verifierReturning(null);
      const { context } = makeContext();

      await expect(build(verifier).canActivate(context)).rejects.toThrow();
      expect(calls).not.toHaveBeenCalled();
    });

    it('rejects a token the verifier refuses', async () => {
      const { verifier } = verifierReturning(null);
      const { context } = makeContext({ authorization: 'Bearer forged' });

      await expect(build(verifier).canActivate(context)).rejects.toBeInstanceOf(
        UnauthenticatedException,
      );
    });

    it('reports 401 rather than 403', async () => {
      const { verifier } = verifierReturning(null);
      const { context } = makeContext({ authorization: 'Bearer forged' });

      const error = await build(verifier)
        .canActivate(context)
        .catch((thrown: unknown) => thrown);

      expect((error as UnauthenticatedException).getStatus()).toBe(401);
    });

    it('admits a valid token and leaves the identity on the request', async () => {
      const { verifier } = verifierReturning({ userId: USER });
      const { context, request } = makeContext({ authorization: `Bearer good` });

      await expect(build(verifier).canActivate(context)).resolves.toBe(true);
      expect(request[VERIFIED_IDENTITY]).toEqual({ userId: USER });
    });

    it.each([
      ['Bearer', 'Bearer token-here'],
      ['bearer', 'bearer token-here'],
      ['BEARER', 'BEARER token-here'],
    ])('accepts the %s scheme, which RFC 7235 says is case-insensitive', async (_label, header) => {
      const { verifier } = verifierReturning({ userId: USER });
      const { context } = makeContext({ authorization: header });

      await expect(build(verifier).canActivate(context)).resolves.toBe(true);
    });

    it.each([
      ['a bare token with no scheme', 'token-here'],
      ['the wrong scheme', 'Basic dXNlcjpwYXNz'],
      ['Bearer with nothing after it', 'Bearer'],
      ['Bearer with only whitespace', 'Bearer    '],
    ])('rejects %s', async (_label, header) => {
      const { verifier } = verifierReturning({ userId: USER });
      const { context } = makeContext({ authorization: header });

      await expect(build(verifier).canActivate(context)).rejects.toBeInstanceOf(
        UnauthenticatedException,
      );
    });
  });

  describe('on a @Public() route', () => {
    beforeEach(() => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    });

    afterEach(() => jest.restoreAllMocks());

    it('admits a request with no token at all', async () => {
      // A load balancer probing /health holds no token. If this returned 401
      // the application would report itself down during an auth outage.
      const { verifier } = verifierReturning(null);
      const { context } = makeContext();

      await expect(build(verifier).canActivate(context)).resolves.toBe(true);
    });

    it('still identifies a caller who does present a valid token', async () => {
      const { verifier } = verifierReturning({ userId: USER });
      const { context, request } = makeContext({ authorization: 'Bearer good' });

      await expect(build(verifier).canActivate(context)).resolves.toBe(true);
      expect(request[VERIFIED_IDENTITY]).toEqual({ userId: USER });
    });

    it('admits the request even when that token is invalid', async () => {
      // Verification on a public route must never be able to reject it.
      // Otherwise an expired session turns a public page into a 401.
      const { verifier } = verifierReturning(null);
      const { context, request } = makeContext({ authorization: 'Bearer expired' });

      await expect(build(verifier).canActivate(context)).resolves.toBe(true);
      expect(request[VERIFIED_IDENTITY]).toBeUndefined();
    });
  });

  it('passes non-HTTP contexts through untouched', async () => {
    // A queue job has no request and no caller. Without this the guard would
    // reject every background job the worker runs.
    const { verifier, calls } = verifierReturning(null);
    const { context } = makeContext({}, 'rpc');

    await expect(build(verifier).canActivate(context)).resolves.toBe(true);
    expect(calls).not.toHaveBeenCalled();
  });
});
