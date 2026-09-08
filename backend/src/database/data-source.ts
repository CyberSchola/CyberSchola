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

/**
 * Connection used by migrations.
 *
 * DIRECT_URL is the session-mode pooler on 5432. Migrations hold advisory
 * locks and run multi-statement transactions, which need the same backend
 * connection for their whole life. Transaction-mode pooling hands a different
 * backend out per transaction, so running migrations through it is a race
 * waiting to be lost.
 *
 * Falls back to DATABASE_URL so that a local Postgres, which has no separate
 * session endpoint, needs only one variable set.
 */
export const migrationDataSourceOptions: PostgresConnectionOptions = {
  type: 'postgres',
  url: env('DIRECT_URL') ?? env('DATABASE_URL'),
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
