import { NodeEnv, validateEnv } from './env.validation';

/**
 * The minimum environment a process needs to boot.
 *
 * Every case builds on this rather than restating it, so a test that adds a
 * required variable does not have to be copied into thirty other tests.
 */
const VALID = {
  NODE_ENV: 'development',
  PORT: '3000',
  API_PREFIX: 'api/v1',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/cyberschola',
  DATABASE_SSL: 'false',
  DATABASE_POOL_MAX: '10',
} as const;

const withEnv = (overrides: Record<string, unknown> = {}) => ({ ...VALID, ...overrides });

describe('validateEnv', () => {
  it('accepts a complete, valid environment', () => {
    const result = validateEnv(withEnv({ NODE_ENV: 'production', PORT: '8080' }));

    expect(result.NODE_ENV).toBe(NodeEnv.Production);
    expect(result.PORT).toBe(8080);
    expect(result.API_PREFIX).toBe('api/v1');
  });

  it('coerces PORT from the string the environment always gives us', () => {
    expect(validateEnv(withEnv({ PORT: '3000' })).PORT).toBe(3000);
    expect(typeof validateEnv(withEnv({ PORT: '3000' })).PORT).toBe('number');
  });

  it('applies documented defaults when a variable is absent', () => {
    const result = validateEnv(
      withEnv({ NODE_ENV: undefined, PORT: undefined, API_PREFIX: undefined }),
    );

    expect(result.NODE_ENV).toBe(NodeEnv.Development);
    expect(result.PORT).toBe(3000);
    expect(result.API_PREFIX).toBe('api/v1');
  });

  describe('NODE_ENV', () => {
    it.each(Object.values(NodeEnv))('accepts %s', (value) => {
      expect(validateEnv(withEnv({ NODE_ENV: value })).NODE_ENV).toBe(value);
    });

    it('rejects an unknown environment rather than guessing', () => {
      // A typo here is how a process ends up in "production-ish" mode: Swagger
      // served publicly, debug logging on, safeguards keyed to an exact string
      // silently not applying.
      expect(() => validateEnv(withEnv({ NODE_ENV: 'prod' }))).toThrow(/NODE_ENV must be one of/);
      expect(() => validateEnv(withEnv({ NODE_ENV: 'Production' }))).toThrow(
        /NODE_ENV must be one of/,
      );
    });
  });

  describe('PORT', () => {
    it.each([
      ['not-a-number', /PORT must be an integer/],
      ['0', /PORT must be between/],
      ['70000', /PORT must be between/],
      ['-1', /PORT must be between/],
      ['3000.5', /PORT must be an integer/],
    ])('rejects %s', (value, expected) => {
      expect(() => validateEnv(withEnv({ PORT: value }))).toThrow(expected);
    });

    it('accepts the boundaries', () => {
      expect(validateEnv(withEnv({ PORT: '1' })).PORT).toBe(1);
      expect(validateEnv(withEnv({ PORT: '65535' })).PORT).toBe(65535);
    });
  });

  describe('API_PREFIX', () => {
    it.each(['api', 'api/v1', 'api/v2/internal'])('accepts %s', (value) => {
      expect(validateEnv(withEnv({ API_PREFIX: value })).API_PREFIX).toBe(value);
    });

    it.each(['/api/v1', 'api/v1/', 'api//v1', 'API/V1', 'api v1'])('rejects %s', (value) => {
      // A leading or trailing slash produces a double slash in every route and
      // silently breaks the frontend's URL building.
      expect(() => validateEnv(withEnv({ API_PREFIX: value }))).toThrow(/API_PREFIX/);
    });
  });

  it('reports every problem at once rather than one per restart', () => {
    expect(() =>
      validateEnv(withEnv({ NODE_ENV: 'nope', PORT: '0', API_PREFIX: '/bad/' })),
    ).toThrow(/NODE_ENV[\s\S]*PORT[\s\S]*API_PREFIX/);
  });

  it('ignores variables it does not own, so later phases can add their own', () => {
    expect(() => validateEnv(withEnv({ REDIS_URL: '', SUPABASE_SECRET_KEY: 'x' }))).not.toThrow();
  });

  describe('DATABASE_URL', () => {
    it.each([
      'postgres://user:pass@localhost:5432/db',
      'postgresql://user:pass@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
    ])('accepts %s', (url) => {
      expect(validateEnv(withEnv({ DATABASE_URL: url })).DATABASE_URL).toBe(url);
    });

    it('refuses to boot when it is missing', () => {
      // Without this the process starts and the first request that touches the
      // database fails, in production, in front of a user.
      expect(() => validateEnv(withEnv({ DATABASE_URL: undefined }))).toThrow(/DATABASE_URL/);
    });

    it.each(['', 'localhost:5432', 'mysql://user:pass@host/db', 'not a url'])(
      'rejects %s',
      (url) => {
        expect(() => validateEnv(withEnv({ DATABASE_URL: url }))).toThrow(/DATABASE_URL/);
      },
    );
  });

  describe('DIRECT_URL', () => {
    it('is optional, because a local Postgres has no separate session endpoint', () => {
      expect(() => validateEnv(withEnv({ DIRECT_URL: undefined }))).not.toThrow();
    });

    it('is still validated when present', () => {
      expect(() => validateEnv(withEnv({ DIRECT_URL: 'not-a-url' }))).toThrow(/DIRECT_URL/);
    });

    it('accepts the session pooler on 5432', () => {
      const url = 'postgresql://user:pass@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';

      expect(validateEnv(withEnv({ DIRECT_URL: url })).DIRECT_URL).toBe(url);
    });
  });

  describe('DATABASE_SSL', () => {
    it.each(['true', 'false'])('accepts %s', (value) => {
      expect(validateEnv(withEnv({ DATABASE_SSL: value })).DATABASE_SSL).toBe(value);
    });

    it.each(['yes', '1', '0', 'TRUE', 'True', ''])('rejects %s', (value) => {
      // The data source reads this as `=== 'true'`. Anything else is treated
      // as false, so a value that looks affirmative but is not the exact
      // string would silently connect to Supabase without TLS. "1" is the
      // dangerous one: a boolean-string validator accepts it.
      expect(() => validateEnv(withEnv({ DATABASE_SSL: value }))).toThrow(/DATABASE_SSL/);
    });
  });

  describe('DATABASE_POOL_MAX', () => {
    it('coerces from a string and accepts the boundaries', () => {
      expect(validateEnv(withEnv({ DATABASE_POOL_MAX: '1' })).DATABASE_POOL_MAX).toBe(1);
      expect(validateEnv(withEnv({ DATABASE_POOL_MAX: '100' })).DATABASE_POOL_MAX).toBe(100);
    });

    it.each(['0', '101', '-5', 'ten', '10.5'])('rejects %s', (value) => {
      // Every replica and the worker share one pooler budget, so an oversized
      // per-process pool exhausts it long before the database is under strain.
      expect(() => validateEnv(withEnv({ DATABASE_POOL_MAX: value }))).toThrow(/DATABASE_POOL_MAX/);
    });
  });
});
