import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { VERIFIED_IDENTITY, type AuthenticatedRequest } from '../auth/auth.guard';
import {
  ResourceNotFoundException,
  ValidationFailedException,
} from '../common/exceptions/app.exception';
import { TenantTransactionService } from './tenant-transaction.service';

export const TENANT_RESOLVER = Symbol('TENANT_RESOLVER');

/** Header a client uses to say which of its schools it is acting in. */
export const SCHOOL_SELECTOR_HEADER = 'x-school-id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The school a request acts in, and the caller's standing in it. */
export interface ResolvedTenant {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: string;
}

/**
 * Decides which school a request acts within.
 *
 * Decision 17A: the answer comes from the membership table, never from a token
 * body. A token establishes identity; our own rows establish belonging.
 */
export interface TenantResolver {
  resolve(request: Request): Promise<ResolvedTenant | null>;
}

interface MembershipRow {
  tenant_id: string;
  role: string;
}

/**
 * Resolves the tenant from the caller's memberships.
 *
 * ## Why a client-supplied header is safe here, when `X-Tenant-Id` was not
 *
 * This looks superficially like the header-trusting resolver that BE-T02
 * deliberately refused to write, and the difference is the whole design.
 *
 * `X-Tenant-Id` would have been an *assertion*: the caller names a school and
 * the system acts in it. Any caller could name any school, and the database
 * would faithfully scope every query to it, with the isolation tests still
 * passing perfectly.
 *
 * `X-School-Id` is a *selection*. The set of schools it may choose from is read
 * from the membership table under row-level security, keyed on the verified
 * token subject. A value outside that set never becomes a tenant context; it
 * produces a 404. The header narrows a set the database computed, and cannot
 * add to it.
 *
 * ## Why a wrong school is 404 and not 403
 *
 * Decision 6A. A 403 would confirm the school exists, which is all that is
 * needed to enumerate schools by probing ids. A 404 is byte for byte what an
 * id that was never issued returns.
 */
@Injectable()
export class MembershipTenantResolver implements TenantResolver {
  constructor(private readonly transactions: TenantTransactionService) {}

  async resolve(request: Request): Promise<ResolvedTenant | null> {
    const identity = (request as AuthenticatedRequest)[VERIFIED_IDENTITY];

    if (!identity) {
      // The guard runs first and rejects an unauthenticated request, so this is
      // reachable only on a route the guard let through. Returning null makes
      // the interceptor fail closed rather than assuming.
      return null;
    }

    const memberships = await this.activeMemberships(identity.userId);

    if (memberships.length === 0) {
      // Authenticated, but belongs to no school. Not an error: some accounts
      // legitimately exist before an invitation is accepted. The interceptor
      // turns this into a 401 for tenant-scoped routes, while tenant-optional
      // routes still work, which is how a person can be told they have no
      // schools yet.
      return null;
    }

    const selected = selector(request);

    if (selected === undefined) {
      const only = memberships.length === 1 ? memberships[0] : undefined;

      if (only) {
        // Unambiguous, so there is nothing to choose. Requiring the header
        // anyway would be ceremony for the overwhelmingly common case.
        return this.toResolved(identity.userId, only);
      }

      // Ambiguous. Picking one would silently act in a school the caller did
      // not name, and picking "the first" makes that non-deterministic.
      throw new ValidationFailedException(
        [`Send the ${SCHOOL_SELECTOR_HEADER} header to choose which school to act in.`],
        'This account belongs to more than one school.',
      );
    }

    // `null` means a school was named but is not even a uuid. Same answer as a
    // school that exists and is not yours: see the enumeration note above.
    const match =
      selected === null ? undefined : memberships.find((row) => row.tenant_id === selected);

    if (!match) {
      // Covers both "no such school" and "a school you are not in", on purpose
      // and identically. See the note above about enumeration.
      throw new ResourceNotFoundException();
    }

    return this.toResolved(identity.userId, match);
  }

  /**
   * The caller's live memberships.
   *
   * Runs in a user context and nothing else, which is the bootstrap path: the
   * membership policy permits a row when `user_id = current_user_id()`, so this
   * returns the caller's own rows and cannot return anyone else's. With no
   * tenant set, every other tenant-owned table is empty here.
   *
   * The `user_id` predicate is stated explicitly even though the policy already
   * enforces it. That is the same defence-in-depth as `TenantScopedAction`: the
   * database is the guarantee, the predicate is what lets the index do its work
   * and what makes the intent legible at the call site.
   */
  private async activeMemberships(userId: string): Promise<MembershipRow[]> {
    return this.transactions.runInUserContext(userId, async (manager) =>
      manager.query<MembershipRow[]>(
        `SELECT tenant_id, role
           FROM memberships
          WHERE user_id = $1
            AND status = 'ACTIVE'
            AND deleted_at IS NULL
          ORDER BY created_at`,
        [userId],
      ),
    );
  }

  private toResolved(userId: string, row: MembershipRow): ResolvedTenant {
    return { tenantId: row.tenant_id, userId, role: row.role };
  }
}

/**
 * The requested school: a uuid, `null` when one was sent but is not a uuid, or
 * `undefined` when the caller named no school at all.
 *
 * Three states rather than two, because "sent something unparseable" and "sent
 * nothing" must not be treated alike. Folding them together would mean a client
 * that asked for school B, with a typo, silently acts in school A because A
 * happens to be its only membership. Acting in a school the caller did not name
 * is precisely what this resolver exists to prevent, so a malformed value is an
 * error rather than an absence.
 *
 * The malformed value never reaches the query. It is compared against nothing
 * and produces the same 404 as a school the caller is not in.
 */
function selector(request: Request): string | null | undefined {
  const raw = request.headers[SCHOOL_SELECTOR_HEADER];

  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }

  const value = raw.trim();

  return UUID_PATTERN.test(value) ? value : null;
}
