import { Test, type TestingModule } from '@nestjs/testing';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
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
});
