import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { UnauthenticatedException } from '../common/exceptions/app.exception';
import { PUBLIC_KEY } from './public.decorator';
import { SupabaseTokenVerifier, type VerifiedIdentity } from './token-verifier';

/**
 * Where the guard leaves the verified caller for the interceptor to pick up.
 *
 * A symbol rather than a string key, so nothing can set it by accident from a
 * body, a query string or a stray middleware. Application code should read the
 * request context rather than this property; it exists only to carry the
 * identity across the few microseconds between the guard and the interceptor.
 */
export const VERIFIED_IDENTITY = Symbol('VERIFIED_IDENTITY');

/** A request that has been through the guard. */
export interface AuthenticatedRequest extends Request {
  [VERIFIED_IDENTITY]?: VerifiedIdentity;
}

/**
 * Establishes who is calling, before anything else runs.
 *
 * A guard rather than part of the interceptor, because Nest runs guards first
 * and this is the question everything downstream depends on. It also means a
 * rejection happens before any interceptor work, rather than after.
 *
 * It deliberately does not resolve a school. The split is: this answers "who",
 * `TenantContextInterceptor` answers "where", and only the interceptor opens the
 * request context. Keeping a single place that opens the context is what BE-T02
 * established, and having two would make it possible for one to be skipped.
 *
 * Fails closed. Anything other than a valid Bearer token on a non-public route
 * is 401, with no detail about which part failed.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: SupabaseTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // A queue or RPC handler has no request and no caller. Without this the
    // guard would reject every future background job.
    if (context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request);

    const isPublic =
      this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    if (isPublic) {
      // Still verified when one is present, so a public route that also wants
      // to know the caller can, but never required. Verification of a public
      // route's token must not be able to reject the request.
      if (token) {
        request[VERIFIED_IDENTITY] = (await this.verifier.verify(token)) ?? undefined;
      }

      return true;
    }

    if (!token) {
      throw new UnauthenticatedException();
    }

    const identity = await this.verifier.verify(token);

    if (!identity) {
      // One outcome for every failure: missing, malformed, expired, wrong
      // issuer, wrong audience, unknown key. Distinguishing them in the
      // response would tell an attacker which half of a forgery worked.
      throw new UnauthenticatedException();
    }

    request[VERIFIED_IDENTITY] = identity;

    return true;
  }
}

/**
 * Extracts a Bearer token, or null.
 *
 * The scheme is compared case-insensitively because RFC 7235 says it is
 * case-insensitive, and a client sending "bearer" is not an attack.
 */
function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;

  if (typeof header !== 'string') {
    return null;
  }

  const [scheme, ...rest] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer') {
    return null;
  }

  const token = rest.join(' ').trim();

  return token.length > 0 ? token : null;
}
