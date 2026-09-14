import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'auth_public';

/**
 * Marks a route that runs without an authenticated caller.
 *
 * This is a different axis from `@TenantOptional()`, and keeping them separate
 * is deliberate. There are three real combinations and one decorator cannot
 * express all of them:
 *
 * - **Public and tenant-optional:** a health probe, the API documentation.
 * - **Public and tenantless by nature:** a sign-in callback, which runs before
 *   there is an identity at all.
 * - **Authenticated but tenant-optional:** "which schools do I belong to",
 *   asked by a signed-in person who has not yet chosen one. This route must
 *   exist for the school selector to be usable.
 *
 * Collapsing the two into a single "anonymous" marker makes that third case
 * unrepresentable, and the natural workaround is to mark it public. That
 * silently removes authentication from a route that returns a person's
 * school memberships, which is the sort of hole a naming shortcut creates.
 *
 * The conformance suite reads this metadata and holds it to an allow list, so
 * adding it to a route is one line in a diff that a reviewer will be shown.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
