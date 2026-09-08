import { isTransactionPooler, migrationUrl } from './data-source';

const SESSION_POOLER =
  'postgresql://postgres.abc:pw@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';
const TRANSACTION_POOLER =
  'postgresql://postgres.abc:pw@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
const LOCAL = 'postgres://cyberschola:pw@localhost:5433/cyberschola';

describe('isTransactionPooler', () => {
  it.each([
    TRANSACTION_POOLER,
    'postgresql://u:p@host:6543/postgres',
    'postgresql://u:p@host:5432/postgres?pgbouncer=true',
    'postgresql://u:p@host:6543',
  ])('recognises %s', (url) => {
    expect(isTransactionPooler(url)).toBe(true);
  });

  it.each([SESSION_POOLER, LOCAL, 'postgres://u:p@host:5432/db'])('accepts %s', (url) => {
    expect(isTransactionPooler(url)).toBe(false);
  });

  it('does not mistake a port that merely contains 6543', () => {
    // A naive substring check would flag this, and refusing a valid connection
    // is as disruptive as accepting an invalid one.
    expect(isTransactionPooler('postgres://u:p@host:15432/db')).toBe(false);
    expect(isTransactionPooler('postgres://u:p@host:65431/db')).toBe(false);
  });

  it('does not match a parameter that merely starts with pgbouncer=true', () => {
    expect(isTransactionPooler('postgres://u:p@host:5432/db?pgbouncer=truthy')).toBe(false);
  });
});

describe('migrationUrl', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  function setEnv(values: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  it('prefers DIRECT_URL when it is set', () => {
    setEnv({ NODE_ENV: 'production', DIRECT_URL: SESSION_POOLER, DATABASE_URL: LOCAL });

    expect(migrationUrl()).toBe(SESSION_POOLER);
  });

  describe('outside development and test', () => {
    it.each(['production', 'staging'])(
      'refuses to fall back to DATABASE_URL when NODE_ENV is %s',
      (nodeEnv) => {
        // This is the whole point of the guard. A deployment missing
        // DIRECT_URL previously ran migrations through the transaction pooler
        // in silence, which is exactly what the architecture forbids.
        setEnv({ NODE_ENV: nodeEnv, DIRECT_URL: undefined, DATABASE_URL: SESSION_POOLER });

        expect(() => migrationUrl()).toThrow(/DIRECT_URL is required/);
      },
    );

    it('names the environment in the error, so the fix is obvious', () => {
      setEnv({ NODE_ENV: 'staging', DIRECT_URL: undefined, DATABASE_URL: SESSION_POOLER });

      expect(() => migrationUrl()).toThrow(/"staging"/);
    });

    it('explains why, not merely that it refused', () => {
      setEnv({ NODE_ENV: 'production', DIRECT_URL: undefined, DATABASE_URL: SESSION_POOLER });

      expect(() => migrationUrl()).toThrow(/session-mode pooler/);
    });
  });

  describe('in development and test', () => {
    it.each(['development', 'test'])(
      'falls back to DATABASE_URL when NODE_ENV is %s',
      (nodeEnv) => {
        // A local Postgres has no separate session endpoint, so requiring both
        // variables would be busywork with no safety benefit.
        setEnv({ NODE_ENV: nodeEnv, DIRECT_URL: undefined, DATABASE_URL: LOCAL });

        expect(migrationUrl()).toBe(LOCAL);
      },
    );

    it('treats an unset NODE_ENV as development', () => {
      setEnv({ NODE_ENV: undefined, DIRECT_URL: undefined, DATABASE_URL: LOCAL });

      expect(migrationUrl()).toBe(LOCAL);
    });

    it('treats a blank DIRECT_URL as absent rather than as a value', () => {
      setEnv({ NODE_ENV: 'development', DIRECT_URL: '   ', DATABASE_URL: LOCAL });

      expect(migrationUrl()).toBe(LOCAL);
    });
  });

  describe('the transaction pooler is refused whatever supplied it', () => {
    it('rejects a DIRECT_URL pointing at the transaction pooler', () => {
      // The first guard cannot catch this: DIRECT_URL is set, it is just set
      // to the wrong endpoint.
      setEnv({ NODE_ENV: 'production', DIRECT_URL: TRANSACTION_POOLER });

      expect(() => migrationUrl()).toThrow(/transaction-mode pooler/);
    });

    it('rejects it in development too, where the fallback supplied it', () => {
      setEnv({ NODE_ENV: 'development', DIRECT_URL: undefined, DATABASE_URL: TRANSACTION_POOLER });

      expect(() => migrationUrl()).toThrow(/transaction-mode pooler/);
    });

    it('says which marker it detected, so the fix is obvious', () => {
      setEnv({ NODE_ENV: 'production', DIRECT_URL: TRANSACTION_POOLER });

      expect(() => migrationUrl()).toThrow(/6543|pgbouncer/);
    });
  });

  it('returns undefined when nothing is configured in development', () => {
    // Not an error here: the TypeORM CLI is imported by tooling that does not
    // always have a database, and the driver reports a clear failure of its
    // own if a command actually needs one.
    setEnv({ NODE_ENV: 'development', DIRECT_URL: undefined, DATABASE_URL: undefined });

    expect(migrationUrl()).toBeUndefined();
  });
});
