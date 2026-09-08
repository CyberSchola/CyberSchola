import { Test, type TestingModule } from '@nestjs/testing';

import { HealthController } from './health.controller';
import { ReadinessService } from './readiness.service';
import { ServiceNotReadyException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/enums/error-code.enum';

describe('HealthController', () => {
  let controller: HealthController;
  let module: TestingModule;
  let readiness: { check: jest.Mock };

  beforeEach(async () => {
    readiness = { check: jest.fn() };

    module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: ReadinessService, useValue: readiness }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  // Without this the Nest application context stays open and Jest reports a
  // worker that failed to exit gracefully, which turns into flaky CI later.
  afterEach(async () => {
    await module.close();
  });

  it('reports the process as live', () => {
    expect(controller.liveness().status).toBe('ok');
  });

  it('identifies which service answered', () => {
    expect(controller.liveness().service).toBe('cyberschola-backend');
  });

  it('reports a non-negative integer uptime', () => {
    const { uptimeSeconds } = controller.liveness();

    expect(Number.isInteger(uptimeSeconds)).toBe(true);
    expect(uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('falls back to a version rather than reporting undefined', () => {
    expect(controller.liveness().version).toEqual(expect.any(String));
    expect(controller.liveness().version).not.toBe('');
  });

  it('exposes nothing beyond the four documented fields', () => {
    // The liveness probe is unauthenticated, so its shape is a security
    // surface: anything added here is readable by anyone who can reach the
    // process. This test fails deliberately if a field is ever added
    // without that being considered.
    expect(Object.keys(controller.liveness()).sort()).toEqual([
      'service',
      'status',
      'uptimeSeconds',
      'version',
    ]);
  });

  describe('readiness probe', () => {
    it('returns the report when every dependency is up', async () => {
      const report = { ready: true, dependencies: { database: 'up' as const } };
      readiness.check.mockResolvedValue(report);

      await expect(controller.readinessProbe()).resolves.toEqual(report);
    });

    it('throws when a dependency is down, so the status is a real 503', async () => {
      readiness.check.mockResolvedValue({
        ready: false,
        dependencies: { database: 'down' as const },
      });

      await expect(controller.readinessProbe()).rejects.toBeInstanceOf(ServiceNotReadyException);
    });

    it('reports unavailable rather than an internal error', async () => {
      readiness.check.mockResolvedValue({
        ready: false,
        dependencies: { database: 'down' as const },
      });

      // A client should retry a 503 and should not retry a 500. Collapsing the
      // two loses that.
      await expect(controller.readinessProbe()).rejects.toMatchObject({
        code: ErrorCode.SERVICE_UNAVAILABLE,
      });
    });

    it('does not attach the dependency report to the thrown error', async () => {
      const report = { ready: false, dependencies: { database: 'down' as const } };
      readiness.check.mockResolvedValue(report);

      // The endpoint is unauthenticated. Which dependency failed is infrastructure
      // detail, and it belongs in the log rather than the response.
      const error = await controller.readinessProbe().catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(ServiceNotReadyException);
      expect(JSON.stringify(error)).not.toContain('database');
      expect((error as ServiceNotReadyException).message).not.toContain('database');
    });
  });
});
