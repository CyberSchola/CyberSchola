import { buildCacheKey, cacheKeyPrefix, globalScope, tenantScope } from './cache-key';

describe('buildCacheKey', () => {
  it('prefixes a tenant-owned key with its tenant', () => {
    expect(buildCacheKey(tenantScope('school-a'), 'dashboard', 'admin')).toBe(
      'tenant:school-a:dashboard:admin',
    );
  });

  it('prefixes an unscoped key with global', () => {
    expect(buildCacheKey(globalScope(), 'feature-flags')).toBe('global:feature-flags');
  });

  it('keeps two tenants in separate namespaces', () => {
    // The entire reason this module exists. If these ever collide, one school
    // reads another school's cached dashboard.
    const a = buildCacheKey(tenantScope('school-a'), 'dashboard');
    const b = buildCacheKey(tenantScope('school-b'), 'dashboard');

    expect(a).not.toBe(b);
    expect(a.startsWith('tenant:school-a:')).toBe(true);
    expect(b.startsWith('tenant:school-b:')).toBe(true);
  });

  it('never produces a bare key', () => {
    // There is no overload that takes a plain string, so an unprefixed key
    // cannot be written at all. This asserts the shape the type system already
    // forces, so a future refactor cannot quietly relax it.
    for (const key of [buildCacheKey(tenantScope('t'), 'x'), buildCacheKey(globalScope(), 'x')]) {
      expect(key).toMatch(/^(tenant:[^:]+|global):/);
    }
  });

  describe('rejects segments that could forge another namespace', () => {
    it('refuses a colon in a key part, since that is the separator', () => {
      // Without this, a part of "b:dashboard" under tenant "a" produces
      // "tenant:a:b:dashboard", which is indistinguishable from a key legally
      // built for a nested namespace.
      expect(() => buildCacheKey(tenantScope('a'), 'b:dashboard')).toThrow(/Unsafe cache key/);
    });

    it('refuses a colon in the tenant id', () => {
      // A tenant id usually arrives from a token or a URL. One containing a
      // colon would let a caller reach a namespace that is not theirs.
      expect(() => buildCacheKey(tenantScope('a:b'), 'dashboard')).toThrow(/Unsafe cache key/);
    });

    it.each(['*', '?', '[', ']', ' ', '\n', '{', '}', '/', '\\'])(
      'refuses %j in a key part',
      (bad) => {
        // Glob characters matter beyond neatness: clearScope matches on a
        // pattern, so a key containing one could be deleted by an unrelated
        // scope's clear, or escape one meant to include it.
        expect(() => buildCacheKey(tenantScope('a'), `dash${bad}board`)).toThrow(
          /Unsafe cache key/,
        );
      },
    );

    it('refuses an empty part', () => {
      expect(() => buildCacheKey(tenantScope('a'), '')).toThrow(/Unsafe cache key/);
    });

    it('refuses an empty tenant id', () => {
      expect(() => buildCacheKey(tenantScope(''), 'x')).toThrow(/Unsafe cache key/);
    });

    it('requires at least one part beyond the scope', () => {
      expect(() => buildCacheKey(tenantScope('a'))).toThrow(/at least one part/);
    });
  });

  it.each(['school-a', 'school_a', 'school.a', 'a1B2', 'head@school', 'A-B_c.d@e'])(
    'accepts the safe segment %s',
    (segment) => {
      expect(() => buildCacheKey(tenantScope(segment), segment)).not.toThrow();
    },
  );

  it('accepts a uuid tenant id, which is what P1 will pass', () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

    expect(buildCacheKey(tenantScope(id), 'dashboard')).toBe(`tenant:${id}:dashboard`);
  });
});

describe('cacheKeyPrefix', () => {
  it('ends with the separator, so it cannot match a sibling tenant', () => {
    // "tenant:school-a" without the trailing colon would also prefix-match
    // "tenant:school-ab", and clearing one school's cache would clear part of
    // another's.
    expect(cacheKeyPrefix(tenantScope('school-a'))).toBe('tenant:school-a:');
    expect(cacheKeyPrefix(globalScope())).toBe('global:');
  });

  it('matches every key built for the same scope', () => {
    const scope = tenantScope('school-a');
    const prefix = cacheKeyPrefix(scope);

    for (const parts of [['dashboard'], ['dashboard', 'admin'], ['class', 'jss2', 'students']]) {
      expect(buildCacheKey(scope, ...parts).startsWith(prefix)).toBe(true);
    }
  });

  it('does not match a different tenant whose id shares a prefix', () => {
    const prefix = cacheKeyPrefix(tenantScope('school-a'));

    expect(buildCacheKey(tenantScope('school-ab'), 'dashboard').startsWith(prefix)).toBe(false);
  });

  it('applies the same segment rules as the builder', () => {
    expect(() => cacheKeyPrefix(tenantScope('a:b'))).toThrow(/Unsafe cache key/);
  });
});
