import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { corsOrigins, NodeEnv, validateEnv } from './env.validation';

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
  REDIS_URL: 'redis://localhost:6379',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_JWKS_URL: 'https://project.supabase.co/auth/v1/.well-known/jwks.json',
  GROQ_API_KEY: 'gsk_test_key',
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
    expect(() =>
      validateEnv(withEnv({ SUPABASE_SECRET_KEY: 'x', LIVEKIT_URL: 'wss://x' })),
    ).not.toThrow();
  });

  describe('REDIS_URL', () => {
    it.each(['redis://localhost:6379', 'rediss://user:pw@redis.example.com:6380/0'])(
      'accepts %s',
      (url) => {
        expect(validateEnv(withEnv({ REDIS_URL: url })).REDIS_URL).toBe(url);
      },
    );

    it('refuses to boot when it is missing', () => {
      // Redis holds the rate limit and AI quota counters. Booting without it
      // would serve traffic with those controls absent, which fails open.
      expect(() => validateEnv(withEnv({ REDIS_URL: undefined }))).toThrow(/REDIS_URL/);
    });

    it.each(['', 'localhost:6379', 'http://localhost:6379', 'not a url'])('rejects %s', (url) => {
      expect(() => validateEnv(withEnv({ REDIS_URL: url }))).toThrow(/REDIS_URL/);
    });
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
  describe('optional variables shipped blank in .env.example', () => {
    // dotenv turns `NAME=` into '' rather than undefined, and @IsOptional only
    // skips null/undefined. Before this was handled, copying .env.example
    // verbatim and filling in only the required values produced a startup
    // failure claiming DIRECT_URL was malformed, when it had not been set.
    it('treats a blank DIRECT_URL as absent rather than malformed', () => {
      expect(validateEnv(withEnv({ DIRECT_URL: '' })).DIRECT_URL).toBeUndefined();
    });

    it('treats a whitespace-only DIRECT_URL as absent too', () => {
      expect(validateEnv(withEnv({ DIRECT_URL: '   ' })).DIRECT_URL).toBeUndefined();
    });

    it('still rejects a DIRECT_URL that is set but wrong', () => {
      // Blank means unset. A real value that is not a postgres URL is still an
      // error, and relaxing the first must not relax the second.
      expect(() => validateEnv(withEnv({ DIRECT_URL: 'mysql://h/d' }))).toThrow(/DIRECT_URL/);
    });
  });

  describe('REDIS_ALLOW_UNKNOWN_EVICTION_POLICY', () => {
    it.each(['true', 'false'])('accepts %s', (value) => {
      expect(
        validateEnv(withEnv({ REDIS_ALLOW_UNKNOWN_EVICTION_POLICY: value }))
          .REDIS_ALLOW_UNKNOWN_EVICTION_POLICY,
      ).toBe(value);
    });

    it('treats blank as absent, since .env.example ships it blank', () => {
      expect(
        validateEnv(withEnv({ REDIS_ALLOW_UNKNOWN_EVICTION_POLICY: '' }))
          .REDIS_ALLOW_UNKNOWN_EVICTION_POLICY,
      ).toBeUndefined();
    });

    it.each(['1', 'yes', 'TRUE', 'True', 'no'])('rejects %s', (value) => {
      // The enforcement compares against the exact string 'true'. A value that
      // looks affirmative but is not that string would be silently ignored,
      // which is how DATABASE_SSL once disabled TLS without anyone noticing.
      expect(() => validateEnv(withEnv({ REDIS_ALLOW_UNKNOWN_EVICTION_POLICY: value }))).toThrow(
        /REDIS_ALLOW_UNKNOWN_EVICTION_POLICY/,
      );
    });
  });
  describe('Supabase', () => {
    it.each(['SUPABASE_URL', 'SUPABASE_JWKS_URL'])('requires %s', (name) => {
      // Required rather than optional. Authentication is not something this
      // application can run without, and booting into a state where the guard
      // cannot verify anything is an invitation to disable it "temporarily".
      const incomplete = withEnv();
      delete (incomplete as Record<string, unknown>)[name];

      expect(() => validateEnv(incomplete)).toThrow(new RegExp(name));
    });

    it.each(['SUPABASE_URL', 'SUPABASE_JWKS_URL'])('rejects a plain http %s', (name) => {
      // A token endpoint reached over http can be rewritten in transit, which
      // would let an attacker serve their own signing keys.
      expect(() => validateEnv(withEnv({ [name]: 'http://project.supabase.co' }))).toThrow(
        new RegExp(name),
      );
    });

    it.each(['not-a-url', 'ftp://project.supabase.co', ''])(
      'rejects %p as SUPABASE_URL',
      (value) => {
        expect(() => validateEnv(withEnv({ SUPABASE_URL: value }))).toThrow(/SUPABASE_URL/);
      },
    );

    it('accepts a valid pair', () => {
      expect(validateEnv(withEnv()).SUPABASE_URL).toBe('https://project.supabase.co');
    });
  });
  describe('CORS_ORIGINS', () => {
    it('is absent by default, which enables no cross-origin access', () => {
      expect(corsOrigins(validateEnv(withEnv()).CORS_ORIGINS)).toEqual([]);
    });

    it('accepts exact origins, with or without a port', () => {
      const value = 'https://app.example.com,http://localhost:3001';

      expect(corsOrigins(validateEnv(withEnv({ CORS_ORIGINS: value })).CORS_ORIGINS)).toEqual([
        'https://app.example.com',
        'http://localhost:3001',
      ]);
    });

    it.each([
      ['a wildcard', '*'],
      ['a wildcard subdomain', 'https://*.example.com'],
      ['a path', 'https://app.example.com/login'],
      ['a trailing slash', 'https://app.example.com/'],
      ['a space after the comma', 'https://a.example.com, https://b.example.com'],
      ['no scheme', 'app.example.com'],
    ])('refuses %s', (_label, value) => {
      expect(() => validateEnv(withEnv({ CORS_ORIGINS: value }))).toThrow(/CORS_ORIGINS/);
    });
  });


  describe('who production trusts to issue tokens', () => {
    const DEMO_ISSUER = {
      SUPABASE_URL: 'https://api-cyberschola.example.com/demo-auth',
      SUPABASE_JWKS_URL: 'https://api-cyberschola.example.com/demo-auth/jwks.json',
    };

    it('lets staging trust its own demo issuer', () => {
      expect(() => validateEnv(withEnv({ NODE_ENV: 'staging', ...DEMO_ISSUER }))).not.toThrow();
    });

    it('refuses to boot production with any issuer that is not a Supabase project', () => {
      expect(() => validateEnv(withEnv({ NODE_ENV: 'production', ...DEMO_ISSUER }))).toThrow(
        /In production, SUPABASE_URL must be a Supabase project URL/,
      );
    });
      describe('GROQ_API_KEY', () => {
    it('rejects a missing key', () => {
      const incomplete = withEnv();
      delete (incomplete as Record<string, unknown>).GROQ_API_KEY;
      expect(() => validateEnv(incomplete)).toThrow(/GROQ_API_KEY/);
    });

    it('rejects a whitespace-only value', () => {
      expect(() => validateEnv(withEnv({ GROQ_API_KEY: '   ' }))).toThrow(/GROQ_API_KEY/);
    });

    it('accepts a real value', () => {
      expect(validateEnv(withEnv({ GROQ_API_KEY: 'gsk_test' })).GROQ_API_KEY).toBe('gsk_test');
    });
  });

    it('checks the keys as well as the issuer, so they cannot be split', () => {
      expect(() =>
        validateEnv(
          withEnv({
            NODE_ENV: 'production',
            SUPABASE_JWKS_URL: DEMO_ISSUER.SUPABASE_JWKS_URL,
          }),
        ),
      ).toThrow(/In production, SUPABASE_JWKS_URL must be a Supabase project URL/);
    });

    it('refuses a lookalike host that merely contains supabase.co', () => {
      expect(() =>
        validateEnv(
          withEnv({ NODE_ENV: 'production', SUPABASE_URL: 'https://x.supabase.co.evil.example' }),
        ),
      ).toThrow(/SUPABASE_URL/);
    });
  });

  describe('.env.example is the backend configuration contract', () => {
    /**
     * Variables the example documents but the backend never reads.
     *
     * Each one needs a reason, because an undocumented extra is exactly how a
     * frontend key ends up looking like a backend requirement. This list is
     * short on purpose and every entry is a decision somebody made.
     */
    const DOCUMENTED_BUT_UNREAD: Readonly<Record<string, string>> = {
      SUPABASE_SECRET_KEY: 'bypasses RLS; kept as a warning, must never reach the request path',
      LIVEKIT_API_KEY: 'live classes, P5; no code reads it yet',
      LIVEKIT_API_SECRET: 'live classes, P5; no code reads it yet',
      LIVEKIT_URL: 'live classes, P5; no code reads it yet',
      PAYSTACK_SECRET_KEY: 'billing, P7; no code reads it yet',
      TEST_DATABASE_URL: 'read by the integration harness rather than by the application',
    };

    const declared = new Set(
      readFileSync(join(__dirname, '..', '..', '.env.example'), 'utf8')
        .split('\n')
        .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line.trim())?.[1])
        .filter((name): name is string => name !== undefined),
    );

    const validated = Object.keys(validateEnv(withEnv({ DIRECT_URL: VALID.DATABASE_URL })));

    it('documents every variable the application validates', () => {
      // The failure this prevents: adding a required variable and leaving the
      // example behind, so following the example produces a process that
      // refuses to start. DIRECT_URL nearly did this once already.
      const missing = validated.filter((name) => !declared.has(name));

      expect(missing).toEqual([]);
    });

    it('explains every variable it documents but does not read', () => {
      // The failure this prevents is the one review caught: a frontend key
      // sitting in the backend's example, indistinguishable from a backend
      // requirement. SUPABASE_PUBLISHABLE_KEY was removed for exactly this.
      const unexplained = [...declared]
        .filter((name) => !validated.includes(name))
        .filter((name) => !(name in DOCUMENTED_BUT_UNREAD));

      expect(unexplained).toEqual([]);
    });

    it('does not mention SUPABASE_PUBLISHABLE_KEY as a variable', () => {
      // It is a client-side key. It may appear in a comment explaining its
      // absence, which is why this checks the declarations rather than the text.
      expect(declared.has('SUPABASE_PUBLISHABLE_KEY')).toBe(false);
    });
  });
});