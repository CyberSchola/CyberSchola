/**
 * Integration tests.
 *
 * Separate from the unit config on purpose. These need a real Postgres, so
 * they are slower and they fail differently: a red integration run can mean
 * the database is not up rather than the code is wrong. Keeping them apart
 * means `pnpm test` stays fast enough to run constantly, and nobody starts
 * ignoring a suite because it is flaky for environmental reasons.
 *
 * What lives here rather than in a unit test: anything the database enforces.
 * Migrations, row-level security policies, partial unique indexes and check
 * constraints all pass against a mocked repository whether or not they exist.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/.*\.integration-spec\.ts$',
  transform: { '^.+\.(t|j)s$': 'ts-jest' },
  setupFiles: ['reflect-metadata'],
  testEnvironment: 'node',
  // A container start plus a migration run comfortably exceeds Jest's default.
  testTimeout: 60_000,
  maxWorkers: 1,
};
