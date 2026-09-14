import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { DataSource } from 'typeorm';

import { REDIS_CLIENT } from '../redis/redis.constants';

export type DependencyStatus = 'up' | 'down';

export interface ReadinessReport {
  ready: boolean;
  dependencies: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
}

/** How long a dependency gets to answer before it counts as down. */
const PROBE_TIMEOUT_MS = 2_000;

@Injectable()
export class ReadinessService {
  private readonly logger = new Logger(ReadinessService.name);

  /**
   * The probe currently in flight, if any.
   *
   * `Promise.race` bounds how long a caller waits; it does not cancel the
   * query underneath. node-postgres offers no way to abort an in-flight query
   * on a pooled connection, so the connection stays checked out until Postgres
   * itself gives up at `statement_timeout` (30s, set on the pool).
   *
   * That matters because an orchestrator polls readiness on a schedule. With a
   * hung database and a 5s probe interval, starting a fresh query every time
   * would leave roughly six abandoned queries alive at once against a pool of
   * ten, and the pool would be the next thing to fail.
   *
   * Since the query cannot be cancelled, the fix is to stop adding more. While
   * a probe is outstanding every caller receives that same probe, so at most
   * one connection is ever tied up regardless of how often the endpoint is
   * called.
   */
  private inFlight?: Promise<ReadinessReport>;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<ReadinessReport> {
    this.inFlight ??= this.runCheck().finally(() => {
      this.inFlight = undefined;
    });

    return this.inFlight;
  }

  private async runCheck(): Promise<ReadinessReport> {
    // Probed together rather than in sequence. Sequentially, two dependencies
    // each near the timeout would take twice as long as the timeout, and the
    // orchestrator would give up before we answered.
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);

    return {
      ready: database === 'up' && redis === 'up',
      dependencies: { database, redis },
    };
  }

  /**
   * Pings Redis.
   *
   * Redis being down is a readiness failure rather than a degraded mode,
   * because it holds the rate limit and AI quota counters. Serving traffic
   * without them means those controls fail open, which is worse than serving
   * no traffic at all.
   */
  private async checkRedis(): Promise<DependencyStatus> {
    try {
      const reply = await this.withTimeout(this.redis.ping(), PROBE_TIMEOUT_MS);
      return reply === 'PONG' ? 'up' : 'down';
    } catch (error) {
      this.logger.error(
        'Readiness: redis probe failed',
        error instanceof Error ? error.stack : String(error),
      );
      return 'down';
    }
  }

  /**
   * Runs the cheapest possible statement against the pool.
   *
   * `SELECT 1` rather than reading a table: this answers "is there a usable
   * connection", not "is the data correct", and a probe that touches real data
   * turns a slow query into a false outage.
   *
   * The timeout matters more than it looks. Without it a probe against an
   * unreachable database hangs for the driver's own connect timeout, the
   * orchestrator's probe times out instead, and the reason never reaches the
   * log where someone could read it.
   */
  private async checkDatabase(): Promise<DependencyStatus> {
    if (!this.dataSource.isInitialized) {
      this.logger.warn('Readiness: data source is not initialised');
      return 'down';
    }

    try {
      await this.withTimeout(this.dataSource.query('SELECT 1'), PROBE_TIMEOUT_MS);
      return 'up';
    } catch (error) {
      // Logged, never returned. The reason a database is unreachable tends to
      // name a host, a port and a role, and the readiness endpoint is
      // unauthenticated.
      this.logger.error(
        'Readiness: database probe failed',
        error instanceof Error ? error.stack : String(error),
      );
      return 'down';
    }
  }

  private async withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`probe exceeded ${ms}ms`)), ms);
      // Do not hold the event loop open on this timer during shutdown.
      timer.unref?.();
    });

    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
