import { applyDecorators, HttpStatus, SetMetadata } from '@nestjs/common';

import { ApiErrorResponse } from '../common/swagger/api-responses';
import type { Permission } from './permission.matrix';

export const REQUIRES_PERMISSION_KEY = 'auth_requires_permission';
export const NO_PERMISSION_KEY = 'auth_no_permission_required';

/**
 * Declares what a caller must be allowed to do to reach this route.
 *
 * Names a permission rather than a role. `@RequiresPermission(Permission.MembershipWrite)`
 * survives a role being added, renamed or split; `@Roles('SCHOOL_ADMIN')` does
 * not, and every route that names a role has to be found and edited by hand
 * when the role changes.
 *
 * This answers only "may you use this endpoint". Which rows come back is a
 * separate question, answered by the access scope on the action. A teacher and
 * an administrator can hold the same permission and see different data, which
 * is the normal case rather than the exception.
 */
export const RequiresPermission = (permission: Permission) =>
  applyDecorators(
    SetMetadata(REQUIRES_PERMISSION_KEY, permission),
    // Every route that declares a permission can refuse on both counts, so the
    // documentation comes from the same line that creates the refusal.
    ApiErrorResponse(HttpStatus.UNAUTHORIZED, 'No valid access token.'),
    ApiErrorResponse(HttpStatus.FORBIDDEN, `The caller's role does not hold \`${permission}\`.`),
  );

/**
 * Declares that a route is reachable by any authenticated caller.
 *
 * Needed because the default is to deny. A route with no permission declared is
 * refused, so that forgetting the decorator closes an endpoint rather than
 * opening it. That is the same direction the tenant and authentication defaults
 * fail in, and it is the whole reason those two have not gone wrong.
 *
 * This is not `@Public()`. Public means no caller at all; this means any caller
 * will do. `GET /me/schools` is the example: you must be signed in, and there
 * is no permission that could sensibly gate reading your own memberships.
 *
 * The conformance suite holds every use of this to an allow list, so adding one
 * is a line in a diff that a reviewer is shown.
 */
export const NoPermissionRequired = () =>
  applyDecorators(
    SetMetadata(NO_PERMISSION_KEY, true),
    // Any signed-in caller may use the route, so an anonymous one is still refused.
    ApiErrorResponse(HttpStatus.UNAUTHORIZED, 'No valid access token.'),
  );
