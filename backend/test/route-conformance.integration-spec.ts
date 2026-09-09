import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
// `import request from 'supertest'` yields the module object rather than the
// callable under this tsconfig, because esModuleInterop is off and supertest
// is CommonJS with a `default` export. Namespace-importing and unwrapping is
// the form that satisfies both the compiler and the no-require-imports rule,
// without changing a compiler flag the whole project depends on.
import * as supertestModule from 'supertest';

/**
 * supertest is CommonJS and this tsconfig has esModuleInterop off, so the
 * shape differs between what TypeScript believes and what Node hands back:
 * sometimes the callable itself, sometimes a namespace wrapping it as
 * `default`. Unwrapping at runtime handles both without changing a compiler
 * flag the whole project depends on.
 */
type SupertestFn = typeof supertestModule;
const maybeWrapped = supertestModule as unknown as { default?: SupertestFn };
const request: SupertestFn = maybeWrapped.default ?? supertestModule;

import { Controller, Get, Module } from '@nestjs/common';

import { AppModule } from '../src/app.module';
import { collectRoutes, type RouteRecord } from '../src/common/testing/route-inventory';

/**
 * A tenant-scoped route that exists only for this suite.
 *
 * Without it the behavioural assertions are vacuous: the application currently
 * exposes only health routes, both tenant-optional, so a loop over "every
 * tenant-scoped route" iterates nothing and passes by finding no work. This
 * controller carries no `@TenantOptional()`, so it is exactly what a real
 * tenant-owned endpoint will look like, and the interceptor must refuse it.
 */
@Controller('conformance-probe')
class ScopedProbeController {
  @Get()
  read(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [ScopedProbeController] })
class ScopedProbeModule {}

/**
 * The conformance gate from decision 9A.
 *
 * The point is not to check today's two health routes. It is that a route
 * added in six months, by whoever is on the team then, cannot quietly skip
 * tenant scoping. A checklist item depends on someone remembering across two
 * hundred endpoints; this fails the build.
 *
 * Run in the integration layer rather than as a unit test, because it boots
 * the real application. Faking the database and cache would mean discovering
 * routes from a different application than the one that ships, and it also
 * lets these assertions check real HTTP behaviour rather than only metadata.
 */
describe('route conformance', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  /** Typed once, because getHttpServer() is `any` and the lint rules reject it. */
  const server = (): Server => app.getHttpServer() as Server;
  let routes: RouteRecord[];

  /**
   * Routes that legitimately operate without a school.
   *
   * Keep it short. Every entry is a route the tenant interceptor will not
   * protect, so each is a deliberate decision rather than a convenience.
   * Sign-in endpoints join it in BE-A01, because they run before there is a
   * membership to resolve a tenant from.
   */
  const ALLOWED_WITHOUT_TENANT = new Set(['GET /health', 'GET /health/ready']);

  /** The probe above is not part of the application, so it is excluded. */
  const PROBE_PATH = '/conformance-probe';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule, ScopedProbeModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    routes = collectRoutes(
      moduleRef.get(DiscoveryService),
      moduleRef.get(MetadataScanner),
      moduleRef.get(Reflector),
    );
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('the inventory', () => {
    it('is discovered from the running application, not a hand-kept list', () => {
      // A hand-kept list going stale is the failure this whole suite exists to
      // prevent, so it must never be the source.
      expect(routes.length).toBeGreaterThan(0);
    });

    it('names the controller and handler, so a failure is greppable', () => {
      for (const route of routes) {
        expect(route.controller).not.toBe('');
        expect(route.handler).not.toBe('');
      }
    });
  });

  describe('the tenant-optional allow list', () => {
    it('covers every route that opts out of tenant scoping', () => {
      const unlisted = routes
        .filter((route) => route.tenantOptional)
        .map((route) => `${route.method} ${route.path}`)
        .filter((signature) => !ALLOWED_WITHOUT_TENANT.has(signature));

      // If this fails, a route was marked @TenantOptional() without being
      // added here. Either it genuinely needs no tenant, in which case add it
      // and say why in the pull request, or the decorator is wrong.
      expect(unlisted).toEqual([]);
    });

    it('contains no stale entries', () => {
      // Otherwise exemptions accumulate, and one day a new route matches an old
      // entry by coincidence and is silently exempted.
      const signatures = new Set(routes.map((route) => `${route.method} ${route.path}`));

      expect([...ALLOWED_WITHOUT_TENANT].filter((entry) => !signatures.has(entry))).toEqual([]);
    });

    it('is exactly the two health probes today', () => {
      const optional = routes
        .filter((route) => route.tenantOptional)
        .map((route) => `${route.method} ${route.path}`)
        .sort();

      expect(optional).toEqual(['GET /health', 'GET /health/ready']);
    });

    it('does not exempt the probe, so the behavioural checks below mean something', () => {
      const probe = routes.find((route) => route.path === PROBE_PATH);

      expect(probe).toBeDefined();
      expect(probe?.tenantOptional).toBe(false);
    });
  });

  describe('behaviour, not just metadata', () => {
    it('serves the health probes without any credentials', async () => {
      await request(server()).get('/api/v1/health').expect(200);
    });

    it('refuses a tenant-scoped route with 401, not 200', async () => {
      // The probe handler returns 200 if it is ever reached. It must not be,
      // because no tenant can be resolved until authentication lands.
      const response = await request(server()).get(`/api/v1${PROBE_PATH}`);

      expect(response.status).toBe(401);
    });

    it('returns the standard error envelope for that refusal', async () => {
      const response = await request(server()).get(`/api/v1${PROBE_PATH}`);

      expect(response.body).toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED' });
    });

    it('never reaches the handler, so no school data is computed', async () => {
      const response = await request(server()).get(`/api/v1${PROBE_PATH}`);

      expect(JSON.stringify(response.body)).not.toContain('"ok"');
    });

    it('rejects every tenant-scoped route the application exposes', async () => {
      const scoped = routes.filter(
        (route) =>
          !ALLOWED_WITHOUT_TENANT.has(`${route.method} ${route.path}`) &&
          route.method === 'GET' &&
          !route.path.includes(':'),
      );

      // Asserted rather than assumed: an empty list would make this loop pass
      // by doing nothing, which is the exact failure this suite exists to stop.
      expect(scoped.length).toBeGreaterThan(0);

      for (const route of scoped) {
        const response = await request(server()).get(`/api/v1${route.path}`);
        expect(response.status).toBe(401);
      }
    });
  });
});
