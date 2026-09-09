import { SetMetadata } from '@nestjs/common';

export const TENANT_OPTIONAL_KEY = 'tenant_optional';

/**
 * Marks a route that legitimately operates without a school.
 *
 * The list is short and should stay short: health probes, API documentation,
 * and later the sign-in endpoints, which by definition run before there is a
 * membership to resolve a tenant from.
 *
 * Everything else is tenant-scoped and denied without a resolved tenant. That
 * default is the point: a new endpoint is closed until someone deliberately
 * opens it, rather than open until someone remembers to close it.
 *
 * The conformance suite reads this metadata. A route marked optional is
 * excluded from the cross-tenant checks, so adding the decorator to something
 * that does touch school data is a way to lose that coverage. It is one line
 * in a diff and worth looking at in review.
 */
export const TenantOptional = () => SetMetadata(TENANT_OPTIONAL_KEY, true);
