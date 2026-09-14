import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
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

    if (tenantOptional === true) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();

    return from(this.resolver.resolve(request)).pipe(
      switchMap((tenantId) => {
        if (!tenantId) {
          throw new UnauthenticatedException();
        }

        const requestId =
          typeof request.headers['x-request-id'] === 'string'
            ? request.headers['x-request-id']
            : randomUUID();

        return runWithRequestContext({ tenantId, requestId }, () => next.handle());
      }),
    );
  }
}
