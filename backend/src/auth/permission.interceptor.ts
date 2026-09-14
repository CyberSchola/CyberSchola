import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';

import { ForbiddenException, UnauthenticatedException } from '../common/exceptions/app.exception';
import { getRequestContext } from '../tenancy/request-context';
import { type Permission, roleHasPermission } from './permission.matrix';
import { NO_PERMISSION_KEY, REQUIRES_PERMISSION_KEY } from './requires-permission.decorator';
import { PUBLIC_KEY } from './public.decorator';

/**
 * Decides whether the caller may use this route at all.
 *
 * ## Why this is an interceptor and not a guard
 *
 * Authorization belongs in a guard, idiomatically, and this is not one. The
 * reason is ordering rather than preference: Nest runs every guard before every
 * interceptor, and the caller's role is resolved by `TenantContextInterceptor`.
 * A guard would therefore run before the role exists and would have to resolve
 * membership a second time, which means a second database round trip per
 * request and two places that can disagree about who the caller is.
 *
 * Registered after `TenantContextInterceptor`, so the request context is open
 * and the role is already in it. A denial then happens inside that context,
 * which is what lets the audit line carry the tenant, the user and the request
 * id without deriving any of them again.
 *
 * Moving tenant resolution into a guard would make this a guard too, and that
 * is the tidier arrangement. It is deliberately not done here: it would rewrite
 * the interceptor that is still under review in the previous pull request, to
 * buy correctness this already has. The option is recorded rather than
 * foreclosed.
 *
 * ## Default deny
 *
 * A route that declares no permission is refused. Forgetting the decorator
 * closes an endpoint instead of opening one, which is the direction the tenant
 * and authentication checks already fail in. Routes that genuinely need no
 * permission say so with `@NoPermissionRequired()`, and the conformance suite
 * holds those to an allow list.
 */
@Injectable()
export class PermissionInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // A queue or RPC handler has no caller and no route metadata. Without this
    // every future background job would be refused.
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const targets = [context.getHandler(), context.getClass()];

    // A public route has no caller to hold a permission, so there is nothing to
    // check. Skipped before anything else: health probes must never be able to
    // fail with 403, or the application reports itself down whenever this
    // check is wrong.
    if (this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_KEY, targets) === true) {
      return next.handle();
    }

    if (
      this.reflector.getAllAndOverride<boolean | undefined>(NO_PERMISSION_KEY, targets) === true
    ) {
      return next.handle();
    }

    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRES_PERMISSION_KEY,
      targets,
    );

    if (required === undefined) {
      // The default-deny branch. This is a developer mistake rather than a
      // caller mistake, so it is worth being blunt about in the message: the
      // route is unreachable until somebody decides what it needs.
      throw new ForbiddenException(
        'This route declares no permission. Add @RequiresPermission(), or ' +
          '@NoPermissionRequired() if any signed-in caller may use it.',
      );
    }

    const role = getRequestContext()?.role;

    if (role === undefined) {
      // Authenticated but with no role in context means no tenant was resolved,
      // which is an authentication problem rather than an authorization one.
      // 401 rather than 403, for the same reason as everywhere else: we cannot
      // claim to know who they are and be refusing them.
      throw new UnauthenticatedException();
    }

    if (!roleHasPermission(role, required)) {
      // 403, not 404. The 404 rule exists to stop enumeration across tenants,
      // and this caller is already inside the tenant: they know the resource
      // exists because they are a member of the school. Telling them the thing
      // does not exist would be false, and would make every permission bug look
      // like a data bug.
      throw new ForbiddenException();
    }

    return next.handle();
  }
}
