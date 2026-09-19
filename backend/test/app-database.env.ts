/**
 * Points the application's own connection at the integration database, as the
 * restricted role.
 *
 * A side effect module on purpose, and it must be the first import of any suite
 * that boots `AppModule`. The data source options read DATABASE_URL when
 * `src/database/data-source` is first evaluated, and `database.setup` evaluates
 * it on import, which is also why this module reads TEST_DATABASE_URL itself
 * instead of importing it from there. Setting the variable later, in `beforeAll`, has no effect: the
 * app quietly connects with whatever `.env` holds, which is the owner of the
 * development database, and every tenant assertion then passes or fails for
 * reasons unrelated to row-level security.
 *
 * The suite still has to give the role this password once migrations have
 * created it.
 */
export const APP_ROLE_PASSWORD = 'app_role_local_only';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is not set. See test/database.setup.ts.');
}

const url = new URL(testDatabaseUrl);
url.username = 'cyberschola_app';
url.password = APP_ROLE_PASSWORD;

process.env.DATABASE_URL = url.toString();
process.env.DATABASE_SSL = 'false';
process.env.NODE_ENV = 'test';
