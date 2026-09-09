import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type Redis from 'ioredis';

import { ReadinessService } from './readiness.service';

function makeDataSource(overrides: Record<string, unknown> = {}): DataSource {
  return {
    isInitialized: true,
    query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    ...overrides,
  } as unknown as DataSource;
}

function makeRedis(overrides: Record<string, unknown> = {}): Redis {
  return { ping: jest.fn().mockResolvedValue('PONG'), ...overrides } as unknown as Redis;
}

/** Builds the service with both dependencies healthy unless overridden. */
function makeService(
  ds: Partial<Record<string, unknown>> = {},
  redis: Record<string, unknown> = {},
) {
  return new ReadinessService(makeDataSource(ds), makeRedis(redis));
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
    const service = makeService();

    await expect(service.check()).resolves.toEqual({
      ready: true,
      dependencies: { database: 'up', redis: 'up' },
    });
  });

  it('runs the cheapest possible statement rather than reading real data', async () => {
    // A probe that touches a table turns a slow query into a false outage, and
    // makes readiness depend on data the probe has no business seeing.
    const query = jest.fn().mockResolvedValue([]);
    const service = makeService({ query });

    await service.check();

    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports not ready when the data source was never initialised', async () => {
    const service = makeService({ isInitialized: false });

    await expect(service.check()).resolves.toEqual({
      ready: false,
      dependencies: { database: 'down', redis: 'up' },
    });
  });

  it('does not attempt a query against an uninitialised data source', async () => {
    const query = jest.fn();
    const service = makeService({ isInitialized: false, query });

    await service.check();

    expect(query).not.toHaveBeenCalled();
  });

  it('reports not ready when the query rejects', async () => {
    const service = makeService({ query: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) });

    await expect(service.check()).resolves.toMatchObject({ ready: false });
  });

  it('never returns the failure reason, which names a host and a role', async () => {
    const service = makeService({
      query: jest
        .fn()
        .mockRejectedValue(new Error('connect ECONNREFUSED db.internal:5432 as cyberschola_app')),
    });

    // The endpoint is unauthenticated. The reason belongs in the log.
    const serialised = JSON.stringify(await service.check());

    expect(serialised).not.toContain('db.internal');
    expect(serialised).not.toContain('cyberschola_app');
    expect(serialised).not.toContain('ECONNREFUSED');
  });

  it('logs the failure reason, so it is not simply lost', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = makeService({ query: jest.fn().mockRejectedValue(new Error('boom')) });

    await service.check();

    expect(error).toHaveBeenCalled();
  });

  it('gives up on a hanging database instead of hanging with it', async () => {
    // Without a timeout the probe waits for the driver's own connect timeout,
    // the orchestrator's probe times out first, and the reason never reaches a
    // log anyone reads.
    const service = makeService({
      query: jest.fn().mockImplementation(() => new Promise(() => {})),
    });

    await expect(service.check()).resolves.toMatchObject({ ready: false });
  }, 10_000);

  describe('concurrent probes', () => {
    it('shares one database query between overlapping callers', async () => {
      // The query cannot be cancelled once started, so the only way to bound
      // connection use is to stop starting new ones. An orchestrator polling
      // a hung database would otherwise tie up a pool connection per probe.
      let resolveQuery: (rows: unknown[]) => void = () => {};
      const query = jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveQuery = resolve;
          }),
      );
      const service = makeService({ query });

      const probes = [service.check(), service.check(), service.check()];
      resolveQuery([{ ok: 1 }]);
      const results = await Promise.all(probes);

      expect(query).toHaveBeenCalledTimes(1);
      expect(results.every((r) => r.ready)).toBe(true);
    });

    it('starts a fresh query once the previous one has settled', async () => {
      const query = jest.fn().mockResolvedValue([{ ok: 1 }]);
      const service = makeService({ query });

      await service.check();
      await service.check();

      // Deduplication must not become caching. A probe answered from a stale
      // result would keep reporting ready after the database had gone.
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('clears the in-flight probe after a failure, so it can recover', async () => {
      const query = jest
        .fn()
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValueOnce([{ ok: 1 }]);
      const service = makeService({ query });

      await expect(service.check()).resolves.toMatchObject({ ready: false });
      await expect(service.check()).resolves.toMatchObject({ ready: true });
    });

    it('recovers after a timed-out probe rather than wedging permanently', async () => {
      // If the in-flight promise were never cleared on timeout, readiness
      // would report down forever even once the database came back.
      let settle: (rows: unknown[]) => void = () => {};
      const query = jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              settle = resolve;
            }),
        )
        .mockResolvedValue([{ ok: 1 }]);
      const service = makeService({ query });

      await expect(service.check()).resolves.toMatchObject({ ready: false });
      settle([]);

      await expect(service.check()).resolves.toMatchObject({ ready: true });
    }, 15_000);
  });

  it('resolves rather than throwing, whatever the database does', async () => {
    for (const rejection of [new Error('x'), 'a string', null, undefined]) {
      const service = makeService({ query: jest.fn().mockRejectedValue(rejection) });

      // A probe that throws produces a 500 from the framework instead of a
      // readable report, which tells an orchestrator nothing useful.
      await expect(service.check()).resolves.toMatchObject({ ready: false });
    }
  });

  describe('redis', () => {
    it('reports not ready when redis does not answer', async () => {
      // Redis holds the rate limit and AI quota counters. Serving traffic
      // without it means those controls fail open, which is worse than serving
      // no traffic.
      const service = makeService({}, { ping: jest.fn().mockRejectedValue(new Error('down')) });

      await expect(service.check()).resolves.toEqual({
        ready: false,
        dependencies: { database: 'up', redis: 'down' },
      });
    });

    it('reports not ready when redis answers with something other than PONG', async () => {
      const service = makeService({}, { ping: jest.fn().mockResolvedValue('') });

      await expect(service.check()).resolves.toMatchObject({ ready: false });
    });

    it('gives up on a hanging redis rather than hanging with it', async () => {
      const service = makeService(
        {},
        { ping: jest.fn().mockImplementation(() => new Promise(() => {})) },
      );

      await expect(service.check()).resolves.toMatchObject({
        dependencies: { database: 'up', redis: 'down' },
      });
    }, 15_000);

    it('never returns the failure reason, which names a host', async () => {
      const service = makeService(
        {},
        {
          ping: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED redis.internal:6379')),
        },
      );

      const serialised = JSON.stringify(await service.check());

      expect(serialised).not.toContain('redis.internal');
      expect(serialised).not.toContain('ECONNREFUSED');
    });

    it('probes both dependencies concurrently, not one after the other', async () => {
      // Sequentially, two dependencies each near the timeout would take twice
      // the timeout, and the orchestrator would give up before we answered.
      //
      // Asserted by ordering rather than by elapsed time. A wall-clock bound
      // fails on a loaded CI runner for reasons that have nothing to do with
      // the behaviour, and a flaky test is worse than no test. If the probes
      // ran in sequence the second would not start until the first resolved,
      // so "both started before either finished" is the property, stated
      // directly.
      const events: string[] = [];
      const release: Array<() => void> = [];

      const gated = (name: string) => () =>
        new Promise((resolve) => {
          events.push(`${name}:start`);
          release.push(() => {
            events.push(`${name}:end`);
            resolve([]);
          });
        });

      const service = makeService(
        { query: jest.fn().mockImplementation(gated('db')) },
        { ping: jest.fn().mockImplementation(() => gated('redis')().then(() => 'PONG')) },
      );

      const pending = service.check();

      // Both must already be in flight before either is allowed to finish.
      await Promise.resolve();
      expect(events).toEqual(['db:start', 'redis:start']);

      release.forEach((fn) => fn());
      await pending;

      expect(events.indexOf('redis:start')).toBeLessThan(events.indexOf('db:end'));
    });

    it('is ready only when both dependencies are up', async () => {
      await expect(makeService().check()).resolves.toMatchObject({ ready: true });
    });
  });
});
