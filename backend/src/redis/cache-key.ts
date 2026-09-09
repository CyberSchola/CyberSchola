/**
 * Where a cached value belongs.
 *
 * A discriminated union rather than an optional tenant id, so a key cannot be
 * built without someone deciding which of these it is. `global` is deliberately
 * verbose to write: an unscoped key is occasionally correct and should never be
 * the path of least resistance.
 */
export type CacheScope =
  { readonly kind: 'tenant'; readonly tenantId: string } | { readonly kind: 'global' };

export const globalScope = (): CacheScope => ({ kind: 'global' });
export const tenantScope = (tenantId: string): CacheScope => ({ kind: 'tenant', tenantId });

/** Separator between key segments. Matches the convention in the blueprint. */
const SEPARATOR = ':';

/**
 * Characters a key segment may contain.
 *
 * Colons are excluded because they are the separator: a segment containing one
 * could forge a key in a different namespace. Given a tenant id from a URL,
 * `tenant:{id}:student` with an id of `a:b` would otherwise let a caller reach
 * into a namespace that is not theirs.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._@-]+$/;

function assertSafeSegment(segment: string, position: string): void {
  if (!SAFE_SEGMENT.test(segment)) {
    throw new Error(
      `Unsafe cache key segment at ${position}: "${segment}". ` +
        'Segments may contain letters, digits, dot, underscore, at, and hyphen. ' +
        'A colon would let one key impersonate another namespace.',
    );
  }
}

/**
 * Builds a namespaced cache key.
 *
 * Every tenant-owned key is prefixed with its tenant, which is the difference
 * between a cache that respects the tenant boundary and one that quietly serves
 * School A's dashboard to School B. The blueprint calls Redis part of the
 * security boundary for exactly this reason, and a cache key is the one place
 * where that boundary is enforced by a string rather than by the database.
 *
 *   buildCacheKey(tenantScope('abc'), 'dashboard', 'admin')
 *     -> "tenant:abc:dashboard:admin"
 *
 *   buildCacheKey(globalScope(), 'feature-flags')
 *     -> "global:feature-flags"
 *
 * Note there is no way to build a bare key. That is the point.
 */
export function buildCacheKey(scope: CacheScope, ...parts: readonly string[]): string {
  if (parts.length === 0) {
    throw new Error('A cache key needs at least one part beyond its scope.');
  }

  parts.forEach((part, index) => assertSafeSegment(part, `part ${index}`));

  if (scope.kind === 'tenant') {
    assertSafeSegment(scope.tenantId, 'tenantId');
    return ['tenant', scope.tenantId, ...parts].join(SEPARATOR);
  }

  return ['global', ...parts].join(SEPARATOR);
}

/**
 * The prefix every key in a scope shares.
 *
 * Used to invalidate a whole namespace. Kept next to the builder so the two
 * cannot drift: a prefix that no longer matches the keys it is meant to clear
 * fails silently, leaving stale data that looks fresh.
 */
export function cacheKeyPrefix(scope: CacheScope): string {
  if (scope.kind === 'tenant') {
    assertSafeSegment(scope.tenantId, 'tenantId');
    return ['tenant', scope.tenantId, ''].join(SEPARATOR);
  }

  return ['global', ''].join(SEPARATOR);
}
