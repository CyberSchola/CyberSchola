import { config as loadEnv } from 'dotenv';

loadEnv();

/**
 * Connection string for the integration Redis.
 *
 * A separate variable from REDIS_URL for the same reason TEST_DATABASE_URL is
 * separate from DATABASE_URL: this suite calls FLUSHDB. Pointing it at a
 * development instance by accident would wipe whatever was cached there, and
 * requiring an explicit opt-in variable makes that impossible rather than
 * merely unlikely.
 */
export function integrationRedisUrl(): string {
  const url = process.env.TEST_REDIS_URL;

  if (!url) {
    throw new Error(
      [
        'TEST_REDIS_URL is not set.',
        '',
        'The cache integration suite runs against a real Redis, because expiry,',
        'SCAN pagination and the eviction policy are properties of the server',
        'rather than of our code. It calls FLUSHDB, so it needs its own instance.',
        '',
        'Locally:  docker compose up -d redis',
        '          TEST_REDIS_URL=redis://localhost:6380',
      ].join('\n'),
    );
  }

  return url;
}
