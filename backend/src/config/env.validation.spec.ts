import { NodeEnv, validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('accepts a complete, valid environment', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      PORT: '8080',
      API_PREFIX: 'api/v1',
    });

    expect(result.NODE_ENV).toBe(NodeEnv.Production);
    expect(result.PORT).toBe(8080);
    expect(result.API_PREFIX).toBe('api/v1');
  });

  it('coerces PORT from the string the environment always gives us', () => {
    expect(validateEnv({ PORT: '3000' }).PORT).toBe(3000);
    expect(typeof validateEnv({ PORT: '3000' }).PORT).toBe('number');
  });

  it('applies documented defaults when a variable is absent', () => {
    const result = validateEnv({});

    expect(result.NODE_ENV).toBe(NodeEnv.Development);
    expect(result.PORT).toBe(3000);
    expect(result.API_PREFIX).toBe('api/v1');
  });

  describe('NODE_ENV', () => {
    it.each(Object.values(NodeEnv))('accepts %s', (value) => {
      expect(validateEnv({ NODE_ENV: value }).NODE_ENV).toBe(value);
    });

    it('rejects an unknown environment rather than guessing', () => {
      // A typo here is how a process ends up in "production-ish" mode: Swagger
      // served publicly, debug logging on, safeguards keyed to an exact string
      // silently not applying.
      expect(() => validateEnv({ NODE_ENV: 'prod' })).toThrow(/NODE_ENV must be one of/);
      expect(() => validateEnv({ NODE_ENV: 'Production' })).toThrow(/NODE_ENV must be one of/);
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
      expect(() => validateEnv({ PORT: value })).toThrow(expected);
    });

    it('accepts the boundaries', () => {
      expect(validateEnv({ PORT: '1' }).PORT).toBe(1);
      expect(validateEnv({ PORT: '65535' }).PORT).toBe(65535);
    });
  });

  describe('API_PREFIX', () => {
    it.each(['api', 'api/v1', 'api/v2/internal'])('accepts %s', (value) => {
      expect(validateEnv({ API_PREFIX: value }).API_PREFIX).toBe(value);
    });

    it.each(['/api/v1', 'api/v1/', 'api//v1', 'API/V1', 'api v1'])('rejects %s', (value) => {
      // A leading or trailing slash produces a double slash in every route and
      // silently breaks the frontend's URL building.
      expect(() => validateEnv({ API_PREFIX: value })).toThrow(/API_PREFIX/);
    });
  });

  it('reports every problem at once rather than one per restart', () => {
    expect(() => validateEnv({ NODE_ENV: 'nope', PORT: '0', API_PREFIX: '/bad/' })).toThrow(
      /NODE_ENV[\s\S]*PORT[\s\S]*API_PREFIX/,
    );
  });

  it('ignores variables it does not own, so BE-F03 can add its own', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'development', DATABASE_URL: 'anything', REDIS_URL: '' }),
    ).not.toThrow();
  });
});
