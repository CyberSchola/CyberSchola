import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';

import { migrationDataSourceOptions } from '../src/database/data-source';

loadEnv();

/**
 * Connection string for the integration database.
 *
 * Deliberately a different variable from DATABASE_URL. These tests drop and
 * rebuild the schema, and pointing them at a development database by accident
 * would destroy someone's local data. Requiring an explicit opt-in variable
 * makes that impossible rather than merely unlikely.
 */
export function integrationDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;

  if (!url) {
    throw new Error(
      [
        'TEST_DATABASE_URL is not set.',
        '',
        'Integration tests run against a real Postgres, never a mock, because the',
        'guarantees under test are enforced by the database rather than by',
        'application code.',
        '',
        'Locally:  docker compose up -d postgres-test',
        '          TEST_DATABASE_URL=postgres://cyberschola:cyberschola_local_only@localhost:5434/cyberschola_test',
      ].join('\n'),
    );
  }

  return url;
}

/**
 * A data source pointed at the integration database, with migrations
 * configured exactly as they are in production.
 *
 * `ssl: false` because this is a local or CI container. The production SSL
 * behaviour is a property of the environment, not of the migration logic these
 * tests exercise.
 */
export function createTestDataSource(): DataSource {
  return new DataSource({
    ...migrationDataSourceOptions,
    url: integrationDatabaseUrl(),
    ssl: false,
    logging: ['error'],
    // Compiled JS does not exist during a ts-jest run, so migrations are
    // loaded from source here. Production loads them from dist/.
    migrations: ['src/database/migrations/*.ts'],
    entities: ['src/**/*.entity.ts'],
  });
}

/** Returns the database to an empty public schema. */
export async function resetSchema(dataSource: DataSource): Promise<void> {
  await dataSource.query('DROP SCHEMA IF EXISTS public CASCADE');
  await dataSource.query('CREATE SCHEMA public');
}
