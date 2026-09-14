import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';

export const TENANT_RESOLVER = Symbol('TENANT_RESOLVER');

/**
 * Decides which school a request acts within.
 *
 * The real implementation arrives in BE-A01: it verifies the Supabase token,
 * takes the subject as a user id, and resolves the tenant from the membership
 * table. That is decision 17A, and the key property is that the tenant is
 * looked up in our own tables rather than read from the token body.
 */
export interface TenantResolver {
  resolve(request: Request): Promise<string | null>;
}

/**
 * The shipped resolver until authentication lands. It resolves nothing.
 *
 * This is deliberate, and it is the safe shape rather than a placeholder.
 *
 * The tempting alternative is a resolver that trusts an `X-Tenant-Id` header
 * "just for now". That is a complete authentication bypass: any caller names
 * any school and the database, which is doing exactly what it is told,
 * faithfully scopes the query to it. Every isolation test in BE-T01 would
 * still pass, because the isolation would be working perfectly on an attacker-
 * supplied tenant. Temporary code of that shape has a way of not being
 * temporary, and it is invisible in review once the diff that added it scrolls
 * past.
 *
 * So the default resolves to null, the guard denies, and every tenant-owned
 * route is closed until there is a real membership to resolve against. Routes
 * that legitimately need no tenant say so with `@TenantOptional()`.
 */
@Injectable()
export class UnresolvedTenantResolver implements TenantResolver {
  private readonly logger = new Logger(UnresolvedTenantResolver.name);
  private warned = false;

  resolve(_request: Request): Promise<string | null> {
    if (!this.warned) {
      // Once per process, not per request: a per-request warning at this
      // volume is noise that gets filtered, and then nobody sees it at all.
      this.logger.warn(
        'Tenant resolution is not implemented yet, so every tenant-scoped route is closed. ' +
          'The membership-backed resolver arrives with authentication in BE-A01.',
      );
      this.warned = true;
    }

    return Promise.resolve(null);
  }
}
