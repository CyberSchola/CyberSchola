import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VERIFIED_IDENTITY, type AuthenticatedRequest } from '../auth/auth.guard';
import { randomUUID } from 'node:crypto';
import { from, type Observable, switchMap } from 'rxjs';

import { UnauthenticatedException } from '../common/exceptions/app.exception';
import { runWithRequestContext } from './request-context';
import { TENANT_OPTIONAL_KEY } from './tenant-optional.decorator';
import { TENANT_RESOLVER, type TenantResolver } from './tenant-resolver';

/**
 * Resolves the tenant once per request and puts it in scope for the handler.
 *
 * Fails closed. A route that is not marked `@TenantOptional()` and has no
 * resolvable tenant is rejected before the handler runs, so an endpoint added
 * before authentication exists cannot serve school data by accident.
 *
 * The rejection is 401 rather than 403. Not being able to establish who is
 * calling is an authentication problem, and a 403 would imply we know who they
 * are and are refusing them, which is a different and more informative claim
 * than we can support.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TENANT_RESOLVER) private readonly resolver: TenantResolver,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Non-HTTP contexts have no request to resolve from. Returning early keeps
    // this from silently rejecting future queue or RPC handlers.
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const tenantOptional = this.reflector.getAllAndOverride<boolean | undefined>(
      TENANT_OPTIONAL_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const requestId =
      typeof request.headers['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : randomUUID();

    if (tenantOptional === true) {
      // No school, but there may still be a caller. A context is opened with
      // just the user so that an authenticated tenant-optional route, such as
      // "which schools do I belong to", can read who is asking. Without this
      // the only way to write that route would be to mark it public, which
      // would drop authentication from a route returning someone's memberships.
      //
      // requireTenantId() throws inside this context, which is correct: a
      // tenant-scoped query does not belong on a tenant-optional route.
      const identity = request[VERIFIED_IDENTITY];

      return runWithRequestContext({ origin: 'http', userId: identity?.userId, requestId }, () =>
        next.handle(),
      );
    }

    return from(this.resolver.resolve(request)).pipe(
      switchMap((resolved) => {
        if (!resolved) {
          throw new UnauthenticatedException();
        }

        return runWithRequestContext(
          {
            origin: 'http',
            tenantId: resolved.tenantId,
            userId: resolved.userId,
            roles: resolved.roles,
            requestId,
          },
          () => next.handle(),
        );
      }),
    );
  }
}
