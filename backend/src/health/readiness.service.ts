import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type DependencyStatus = 'up' | 'down';

export interface ReadinessReport {
  ready: boolean;
  dependencies: {
    database: DependencyStatus;
  };
}

/** How long a dependency gets to answer before it counts as down. */
const PROBE_TIMEOUT_MS = 2_000;

@Injectable()
export class ReadinessService {
  private readonly logger = new Logger(ReadinessService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async check(): Promise<ReadinessReport> {
    const database = await this.checkDatabase();

    return {
      ready: database === 'up',
      dependencies: { database },
    };
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
