import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import { ForbiddenException, UnauthenticatedException } from '../common/exceptions/app.exception';
import { runWithRequestContext } from '../tenancy/request-context';
import { Permission, Role } from './permission.matrix';
import { PermissionInterceptor } from './permission.interceptor';
import { NO_PERMISSION_KEY, REQUIRES_PERMISSION_KEY } from './requires-permission.decorator';
import { PUBLIC_KEY } from './public.decorator';

function makeContext(type = 'http'): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

/** Metadata the route is pretending to carry. */
interface RouteMetadata {
  permission?: Permission;
  noPermission?: boolean;
  isPublic?: boolean;
}

describe('PermissionInterceptor', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
  });

  afterEach(() => jest.restoreAllMocks());

  function build(metadata: RouteMetadata): PermissionInterceptor {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) => {
      if (key === PUBLIC_KEY) return metadata.isPublic;
      if (key === NO_PERMISSION_KEY) return metadata.noPermission;
      if (key === REQUIRES_PERMISSION_KEY) return metadata.permission;
      return undefined;
    });

    return new PermissionInterceptor(reflector);
  }

  const next: CallHandler = { handle: () => of('handled') };

  /** Runs the interceptor with a role in the request context. */
  async function runAs(
    role: string | undefined,
    metadata: RouteMetadata,
    handler: CallHandler = next,
  ): Promise<unknown> {
    const interceptor = build(metadata);

    return runWithRequestContext(
      { tenantId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', userId: 'u', role, requestId: 'r' },
      () => firstValueFrom(interceptor.intercept(makeContext(), handler)),
    );
  }

  describe('the default is to deny', () => {
    it('refuses a route that declares no permission at all', async () => {
      // Forgetting the decorator must close an endpoint rather than open one.
      // This is the same direction the tenant and authentication checks fail
      // in, and the reason neither of those has gone wrong.
      await expect(runAs(Role.SchoolAdmin, {})).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses it even for the most privileged role', async () => {
      await expect(runAs(Role.SchoolAdmin, {})).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('says what the developer should do about it', async () => {
      // This branch is a developer mistake, not a caller mistake, so the
      // message is worth being blunt in. A generic "forbidden" would send
      // someone hunting through the permission matrix for a missing grant.
      const error = await runAs(Role.SchoolAdmin, {}).catch((thrown: unknown) => thrown);

      expect((error as ForbiddenException).message).toMatch(/@RequiresPermission/);
    });

    it('does not run the handler', async () => {
      const handler = jest.fn();

      await expect(runAs(Role.SchoolAdmin, {}, { handle: handler })).rejects.toThrow();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('a route that declares a permission', () => {
    it('admits a role that holds it', async () => {
      await expect(runAs(Role.Teacher, { permission: Permission.MembershipRead })).resolves.toBe(
        'handled',
      );
    });

    it('refuses a role that does not, with 403', async () => {
      // 403 rather than 404. The 404 rule exists to stop enumeration across
      // tenants, and this caller is already inside the tenant: they know the
      // resource exists because they are a member of the school.
      const error = await runAs(Role.Teacher, { permission: Permission.SchoolUpdate }).catch(
        (thrown: unknown) => thrown,
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getStatus()).toBe(403);
    });

    it('refuses an unrecognised role', async () => {
      // Fails closed. A role in the database that the enum does not know about
      // holds nothing, rather than falling through to a default.
      await expect(
        runAs('SUPER_ADMIN', { permission: Permission.MembershipRead }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reports 401 rather than 403 when there is no role at all', async () => {
      // No role in context means no tenant was resolved, which is an
      // authentication problem. A 403 would claim we know who they are and are
      // refusing them, which is a stronger statement than we can support.
      const error = await runAs(undefined, { permission: Permission.MembershipRead }).catch(
        (thrown: unknown) => thrown,
      );

      expect(error).toBeInstanceOf(UnauthenticatedException);
      expect((error as UnauthenticatedException).getStatus()).toBe(401);
    });
  });

  describe('@NoPermissionRequired()', () => {
    it('admits any authenticated role', async () => {
      for (const role of [Role.Student, Role.Parent, Role.SchoolAdmin]) {
        await expect(runAs(role, { noPermission: true })).resolves.toBe('handled');
      }
    });
  });

  describe('@Public()', () => {
    it('skips the check entirely, with no role present', async () => {
      // A load balancer probing /health holds no token and therefore no role.
      // If this could return 403, the application would report itself down
      // whenever the permission logic was wrong.
      await expect(runAs(undefined, { isPublic: true })).resolves.toBe('handled');
    });

    it('takes precedence over a declared permission', async () => {
      // Belt and braces: a route marked public should never be gated by a
      // permission that no anonymous caller could hold.
      await expect(
        runAs(undefined, { isPublic: true, permission: Permission.SchoolUpdate }),
      ).resolves.toBe('handled');
    });
  });

  it('passes non-HTTP contexts through untouched', async () => {
    // A queue job has no route metadata and no caller. Without this the
    // default-deny branch would refuse every background job the worker runs.
    const interceptor = build({});

    await expect(firstValueFrom(interceptor.intercept(makeContext('rpc'), next))).resolves.toBe(
      'handled',
    );
  });

  it('works outside a request context without throwing something unhelpful', () => {
    // Defensive: if the tenant interceptor were ever skipped, this should
    // produce a clean 401 rather than a TypeError from reading a missing store.
    //
    // Asserted synchronously on purpose. The interceptor throws from intercept()
    // rather than returning an observable that errors, which Nest handles
    // identically, and pretending otherwise in the test would hide the shape.
    const interceptor = build({ permission: Permission.MembershipRead });

    expect(() => interceptor.intercept(makeContext(), next)).toThrow(UnauthenticatedException);
  });
});
