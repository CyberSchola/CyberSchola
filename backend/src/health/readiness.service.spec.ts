import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { ReadinessService } from './readiness.service';

function makeDataSource(overrides: Record<string, unknown> = {}): DataSource {
  return {
    isInitialized: true,
    query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    ...overrides,
  } as unknown as DataSource;
}

describe('ReadinessService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('reports ready when the database answers', async () => {
    const service = new ReadinessService(makeDataSource());

    await expect(service.check()).resolves.toEqual({
      ready: true,
      dependencies: { database: 'up' },
    });
  });

  it('runs the cheapest possible statement rather than reading real data', async () => {
    // A probe that touches a table turns a slow query into a false outage, and
    // makes readiness depend on data the probe has no business seeing.
    const query = jest.fn().mockResolvedValue([]);
    const service = new ReadinessService(makeDataSource({ query }));

    await service.check();

    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports not ready when the data source was never initialised', async () => {
    const service = new ReadinessService(makeDataSource({ isInitialized: false }));

    await expect(service.check()).resolves.toEqual({
      ready: false,
      dependencies: { database: 'down' },
    });
  });

  it('does not attempt a query against an uninitialised data source', async () => {
    const query = jest.fn();
    const service = new ReadinessService(makeDataSource({ isInitialized: false, query }));

    await service.check();

    expect(query).not.toHaveBeenCalled();
  });

  it('reports not ready when the query rejects', async () => {
    const service = new ReadinessService(
      makeDataSource({
        query: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      }),
    );

    await expect(service.check()).resolves.toMatchObject({ ready: false });
  });

  it('never returns the failure reason, which names a host and a role', async () => {
    const service = new ReadinessService(
      makeDataSource({
        query: jest
          .fn()
          .mockRejectedValue(new Error('connect ECONNREFUSED db.internal:5432 as cyberschola_app')),
      }),
    );

    // The endpoint is unauthenticated. The reason belongs in the log.
    const serialised = JSON.stringify(await service.check());

    expect(serialised).not.toContain('db.internal');
    expect(serialised).not.toContain('cyberschola_app');
    expect(serialised).not.toContain('ECONNREFUSED');
  });

  it('logs the failure reason, so it is not simply lost', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = new ReadinessService(
      makeDataSource({
        query: jest.fn().mockRejectedValue(new Error('boom')),
      }),
    );

    await service.check();

    expect(error).toHaveBeenCalled();
  });

  it('gives up on a hanging database instead of hanging with it', async () => {
    // Without a timeout the probe waits for the driver's own connect timeout,
    // the orchestrator's probe times out first, and the reason never reaches a
    // log anyone reads.
    const service = new ReadinessService(
      makeDataSource({
        query: jest.fn().mockImplementation(() => new Promise(() => {})),
      }),
    );

    await expect(service.check()).resolves.toMatchObject({ ready: false });
  }, 10_000);

  it('resolves rather than throwing, whatever the database does', async () => {
    for (const rejection of [new Error('x'), 'a string', null, undefined]) {
      const service = new ReadinessService(
        makeDataSource({ query: jest.fn().mockRejectedValue(rejection) }),
      );

      // A probe that throws produces a 500 from the framework instead of a
      // readable report, which tells an orchestrator nothing useful.
      await expect(service.check()).resolves.toMatchObject({ ready: false });
    }
  });
});
