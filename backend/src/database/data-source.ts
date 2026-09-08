import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

// The TypeORM CLI runs outside Nest, so nothing has loaded .env for it.
loadEnv();

/**
 * Reads an environment variable, treating blank as absent.
 *
 * `.env.example` ships every optional variable as `NAME=`, and people copy it.
 * dotenv then sets the variable to an empty string, which is not `undefined`,
 * so `process.env.DIRECT_URL ?? process.env.DATABASE_URL` keeps the empty
 * string and the driver silently falls back to its own defaults, connecting to
 * localhost:5432 instead of failing. That is a confusing way to lose an
 * afternoon, so blank is normalised to undefined here.
 */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

/**
 * Whether to require TLS, and whether to verify the certificate.
 *
 * `rejectUnauthorized` stays true against Supabase. Turning it off is the
 * common shortcut and it silently accepts any certificate, which means the
 * connection is encrypted against a passive observer and useless against
 * anyone able to sit in the middle of it. Local Postgres runs without TLS at
 * all, which is honest rather than pretend-secure.
 */
function sslOptions(): PostgresConnectionOptions['ssl'] {
  return env('DATABASE_SSL') === 'true' ? { rejectUnauthorized: true } : false;
}

/** Environments where a single local Postgres serves both roles. */
const LOCAL_ENVIRONMENTS = new Set(['development', 'test']);

/**
 * Markers of a transaction-mode pooler endpoint.
 *
 * Supabase's transaction pooler listens on 6543, and its connection string
 * carries `pgbouncer=true`. Either is enough to know migrations must not use
 * this URL.
 */
export function isTransactionPooler(url: string): boolean {
  return /:6543(\/|\?|$)/.test(url) || /[?&]pgbouncer=true\b/.test(url);
}

/**
 * Connection string for migrations.
 *
 * DIRECT_URL is the session-mode pooler on 5432. Migrations hold advisory
 * locks and run multi-statement transactions, which need the same backend
 * connection for their whole life. Transaction-mode pooling hands a different
 * backend out per transaction, so running migrations through it is a race
 * waiting to be lost.
 *
 * This used to fall back to DATABASE_URL unconditionally, which meant a
 * production deployment missing DIRECT_URL would silently run migrations
 * through the transaction pooler: precisely the thing the paragraph above
 * forbids. The code now enforces what the comment claims.
 *
 * Two guards, because they catch different mistakes:
 *
 * 1. Outside development and test, DIRECT_URL is required. A missing value is
 *    a deployment error and should read as one.
 * 2. Whatever the URL came from, it must not look like a transaction pooler.
 *    This catches DIRECT_URL being set to the wrong endpoint, which the first
 *    guard cannot see.
 */
export function migrationUrl(): string | undefined {
  const direct = env('DIRECT_URL');
  const fallback = env('DATABASE_URL');
  const nodeEnv = env('NODE_ENV') ?? 'development';

  if (!direct && !LOCAL_ENVIRONMENTS.has(nodeEnv)) {
    throw new Error(
      [
        `DIRECT_URL is required when NODE_ENV is "${nodeEnv}".`,
        '',
        'Migrations must run over the session-mode pooler (port 5432). Falling',
        'back to DATABASE_URL would run them through the transaction pooler,',
        'where advisory locks and multi-statement transactions are not safe.',
      ].join('\n'),
    );
  }

  const resolved = direct ?? fallback;

  if (resolved && isTransactionPooler(resolved)) {
    throw new Error(
      [
        'The migration connection points at a transaction-mode pooler.',
        '',
        'Detected port 6543 or pgbouncer=true. Use the session-mode pooler on',
        'port 5432 for DIRECT_URL. Running migrations through the transaction',
        'pooler is unsafe: it hands out a different backend per transaction, so',
        'advisory locks do not hold.',
      ].join('\n'),
    );
  }

  return resolved;
}

/**
 * Connection used by migrations. See migrationUrl() for why the URL is chosen
 * the way it is.
 */
export const migrationDataSourceOptions: PostgresConnectionOptions = {
  type: 'postgres',
  url: migrationUrl(),
  ssl: sslOptions(),

  // Never true. `synchronize` diffs the entities against the live schema and
  // silently applies whatever it thinks the difference is, which on a
  // production database is a way to lose a column and the data in it. Every
  // schema change goes through a reviewed migration.
  synchronize: false,

  // Migrations run through the CLI, or through a deliberate deploy step. They
  // never run as a side effect of a process booting, or four replicas would
  // race to apply the same migration on every rollout.
  migrationsRun: false,

  entities: ['dist/**/*.entity.js'],
  migrations: ['dist/database/migrations/*.js'],
  migrationsTableName: 'migrations',
  logging: ['error', 'warn', 'migration'],
};

/**
 * Connection used by the running application.
 *
 * DATABASE_URL is the transaction-mode pooler on 6543, which suits one
 * transaction per request and survives far more concurrent clients than direct
 * connections allow.
 *
 * Two consequences to hold onto:
 *
 * 1. No session state may be set outside a transaction. `SET LOCAL` inside one
 *    is fine, and is exactly how the tenant context will be applied, because
 *    transaction pooling pins a transaction to a single backend for its whole
 *    life. A bare `SET` would land on a connection that is then handed to
 *    somebody else.
 * 2. Named prepared statements would break, since they live on the backend
 *    connection. TypeORM never creates any: `PostgresQueryRunner` calls
 *    `connection.query(sql, params)` positionally, and `pg` only promotes a
 *    query to a named statement when a `name` is supplied. There is nothing to
 *    switch off here, despite advice to the contrary that circulates for
 *    other ORMs.
 */
export const appDataSourceOptions: PostgresConnectionOptions = {
  ...migrationDataSourceOptions,
  url: env('DATABASE_URL'),

  // Deliberately modest. Every API replica and the worker share one pooler
  // budget, and a large per-process pool exhausts it long before the database
  // itself is under any strain.
  extra: {
    max: Number.parseInt(env('DATABASE_POOL_MAX') ?? '10', 10),
    // Do not let a wedged query hold a pooled backend forever.
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 30_000,
  },
};

/** Consumed by the TypeORM CLI. Not used by the application at runtime. */
export default new DataSource(migrationDataSourceOptions);
