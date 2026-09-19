import type { Request } from 'express';

import { VERIFIED_IDENTITY } from '../auth/auth.guard';
import {
  ResourceNotFoundException,
  ValidationFailedException,
} from '../common/exceptions/app.exception';
import { MembershipTenantResolver, SCHOOL_SELECTOR_HEADER } from './tenant-resolver';
import type { TenantTransactionService } from './tenant-transaction.service';

const USER = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const SCHOOL_A = '11111111-2222-4333-8444-555555555555';
const SCHOOL_B = '22222222-3333-4444-8555-666666666666';

/** A membership as the fake database holds it, with the roles its role rows give it. */
interface Row {
  tenant_id: string;
  roles: string[];
}

/** Every statement the resolver ran, in order, so the sequence can be asserted. */
let statements: Array<{ sql: string; params: unknown[] }>;

/**
 * The membership rows are supplied directly here. What the database will
 * actually return under the policies is proven in
 * test/membership-isolation.integration-spec.ts against real Postgres; this
 * suite is about the decision made on top of those rows, and the order in which
 * the tenant is set.
 */
function resolverWith(rows: Row[]): MembershipTenantResolver {
  const withIds = rows.map((row, index) => ({ ...row, id: `membership-${index}` }));
  statements = [];

  const manager = {
    query: (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });

      if (sql.includes('FROM memberships')) {
        return Promise.resolve(withIds.map(({ id, tenant_id }) => ({ id, tenant_id })));
      }

      if (sql.includes('FROM membership_roles')) {
        const membership = withIds.find((row) => row.id === params[0]);
        return Promise.resolve((membership?.roles ?? []).map((role) => ({ role })));
      }

      return Promise.resolve([]);
    },
  };

  const transactions = {
    runInUserContext: <T>(_userId: string, work: (manager: unknown) => Promise<T>) => work(manager),
  } as unknown as TenantTransactionService;

  return new MembershipTenantResolver(transactions);
}

function request(headers: Record<string, string> = {}, authenticated = true): Request {
  const value: Record<string | symbol, unknown> = { headers };

  if (authenticated) {
    value[VERIFIED_IDENTITY] = { userId: USER };
  }

  return value as unknown as Request;
}

describe('MembershipTenantResolver', () => {
  it('resolves nothing when the request was never authenticated', async () => {
    // Reachable only on a route the guard let through. Returning null makes the
    // interceptor fail closed rather than assume.
    const resolver = resolverWith([{ tenant_id: SCHOOL_A, roles: ['TEACHER'] }]);

    await expect(resolver.resolve(request({}, false))).resolves.toBeNull();
  });

  it('resolves nothing for an authenticated user who belongs to no school', async () => {
    // A real state: an account can exist before an invitation is accepted.
    await expect(resolverWith([]).resolve(request())).resolves.toBeNull();
  });

  describe('with exactly one membership', () => {
    it('uses it without requiring the header', async () => {
      const resolver = resolverWith([{ tenant_id: SCHOOL_A, roles: ['TEACHER'] }]);

      await expect(resolver.resolve(request())).resolves.toEqual({
        tenantId: SCHOOL_A,
        userId: USER,
        roles: ['TEACHER'],
      });
    });

    it('carries every role from the role rows', async () => {
      const resolver = resolverWith([{ tenant_id: SCHOOL_A, roles: ['PARENT', 'TEACHER'] }]);
      const resolved = await resolver.resolve(request());

      expect(resolved?.roles).toEqual(['PARENT', 'TEACHER']);
    });

    it('resolves a member who holds no role yet, with no roles, rather than refusing them', async () => {
      // They do belong to the school. The permission check then refuses each
      // route with 403, which is the honest answer for a known caller.
      const resolved = await resolverWith([{ tenant_id: SCHOOL_A, roles: [] }]).resolve(request());

      expect(resolved).toEqual({ tenantId: SCHOOL_A, userId: USER, roles: [] });
    });

    it('sets the tenant only after the membership has been read, and to that school', async () => {
      // The role tables are tenant-isolated, so the tenant has to be set before
      // roles can be read. Setting it before the membership lookup would be an
      // assertion; after it, a selection from what the database returned.
      await resolverWith([{ tenant_id: SCHOOL_A, roles: ['TEACHER'] }]).resolve(request());

      const order = statements.map(({ sql }) =>
        sql.includes('FROM memberships')
          ? 'memberships'
          : sql.includes('app.current_tenant')
            ? 'set tenant'
            : sql.includes('membership_roles')
              ? 'roles'
              : 'other',
      );

      expect(order).toEqual(['memberships', 'set tenant', 'roles']);
      expect(statements[1]?.params).toEqual([SCHOOL_A]);
    });
  });

  describe('with more than one membership', () => {
    const both = [
      { tenant_id: SCHOOL_A, roles: ['TEACHER'] },
      { tenant_id: SCHOOL_B, roles: ['PARENT'] },
    ];

    it('refuses to guess when no school is named', async () => {
      // Picking one would act in a school the caller did not choose, and
      // "the first" makes which one non-deterministic.
      await expect(resolverWith(both).resolve(request())).rejects.toBeInstanceOf(
        ValidationFailedException,
      );
    });

    it('names the header in the error, so the client knows what to send', async () => {
      const error = await resolverWith(both)
        .resolve(request())
        .catch((thrown: unknown) => thrown);

      // Read from `details`, which is where AppException carries the actionable
      // part; the message itself stays a stable, non-specific sentence.
      expect((error as ValidationFailedException).details?.join(' ')).toContain(
        SCHOOL_SELECTOR_HEADER,
      );
    });

    it('honours the selected school', async () => {
      const resolver = resolverWith(both);

      await expect(
        resolver.resolve(request({ [SCHOOL_SELECTOR_HEADER]: SCHOOL_B })),
      ).resolves.toEqual({ tenantId: SCHOOL_B, userId: USER, roles: ['PARENT'] });
    });
  });

  describe('a school the caller is not in', () => {
    const outsider = '99999999-8888-4777-8666-555555555555';

    it('is a 404, not a 403', async () => {
      // Decision 6A. A 403 would confirm the school exists, which is all that
      // is needed to enumerate schools by probing ids.
      const resolver = resolverWith([{ tenant_id: SCHOOL_A, roles: ['TEACHER'] }]);

      await expect(
        resolver.resolve(request({ [SCHOOL_SELECTOR_HEADER]: outsider })),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it('cannot be reached by naming it when it is the only membership', async () => {
      // The header selects from a set the database computed. It can narrow
      // that set and never add to it, which is the whole difference between
      // this and the X-Tenant-Id assertion BE-T02 refused to write.
      const resolver = resolverWith([{ tenant_id: SCHOOL_A, roles: ['TEACHER'] }]);

      await expect(
        resolver.resolve(request({ [SCHOOL_SELECTOR_HEADER]: outsider })),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });

  describe('a malformed school selector', () => {
    it('is refused rather than ignored', async () => {
      // The important case. Treating "sent something unparseable" as "sent
      // nothing" would silently act in the caller's only school when they
      // asked, with a typo, for a different one.
      const resolver = resolverWith([{ tenant_id: SCHOOL_A, roles: ['TEACHER'] }]);

      await expect(
        resolver.resolve(request({ [SCHOOL_SELECTOR_HEADER]: 'not-a-uuid' })),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it.each(["'; DROP TABLE memberships; --", '../../etc/passwd', '%00'])(
      'never reaches the query: %p',
      async (hostile) => {
        const resolver = resolverWith([{ tenant_id: SCHOOL_A, roles: ['TEACHER'] }]);

        await expect(
          resolver.resolve(request({ [SCHOOL_SELECTOR_HEADER]: hostile })),
        ).rejects.toBeInstanceOf(ResourceNotFoundException);
      },
    );

    it('treats an empty header as absent, since that is what a client sends by accident', async () => {
      const resolver = resolverWith([{ tenant_id: SCHOOL_A, roles: ['TEACHER'] }]);

      await expect(resolver.resolve(request({ [SCHOOL_SELECTOR_HEADER]: '  ' }))).resolves.toEqual({
        tenantId: SCHOOL_A,
        userId: USER,
        roles: ['TEACHER'],
      });
    });
  });
});
