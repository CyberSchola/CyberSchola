import { Injectable, Logger } from '@nestjs/common';
// Pinned to jose 5, not 6, and the reason is not stylistic. Version 6 is pure
// ESM ("type": "module" with no CJS build) and this project compiles to
// CommonJS, so it type-checks perfectly and then fails to load: Jest cannot
// parse it at all, and the compiled output depends on Node's require(esm)
// interop rather than on anything we control. Version 5 ships both formats,
// has the same API and the same zero dependencies. Upgrading means moving the
// whole project to ESM first.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

/**
 * Algorithms we will accept.
 *
 * Asymmetric only, and stated explicitly rather than inferred from the key.
 * The classic attack on a JWKS-backed verifier is algorithm confusion: an
 * attacker re-signs a token with HS256 using the *public* key as the HMAC
 * secret, and a verifier that trusts the token's own `alg` header validates it
 * happily. Naming the permitted algorithms makes that unrepresentable.
 *
 * `none` is excluded by construction, since it is in neither entry.
 */
const PERMITTED_ALGORITHMS = ['RS256', 'ES256'];

/**
 * Tolerance for clock drift between Supabase and this process, in seconds.
 *
 * Small on purpose. Without any tolerance a few seconds of drift rejects
 * freshly issued tokens and looks like a broken login; with a generous window
 * an expired token stays usable for that long.
 */
const CLOCK_TOLERANCE_SECONDS = 5;

/**
 * Shortest interval between two fetches of the key set.
 *
 * This is a throttle, not a cache lifetime. When a token arrives bearing a
 * `kid` we have not seen, jose refetches, and without a floor a flood of
 * tokens carrying random `kid` values would become a flood of requests to
 * Supabase: a cheap way to have us attack our own identity provider.
 *
 * The cost is that a key rotation takes effect up to this long after it
 * happens. That is acceptable because providers publish a new key before
 * signing with it, and 30 seconds of overlap is far inside that window.
 */
export const JWKS_COOLDOWN_MS = 30_000;

/** How long a successfully fetched key set is reused before being refreshed. */
export const JWKS_CACHE_MAX_AGE_MS = 600_000;

/** Supabase issues access tokens with this audience. */
const SUPABASE_AUDIENCE = 'authenticated';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** What we are willing to believe from a token: who is calling, and nothing else. */
export interface VerifiedIdentity {
  /** The Supabase subject. */
  readonly userId: string;
}

/**
 * Verifies a Supabase access token against the project's published keys.
 *
 * The scope of this class is deliberately narrow: it answers "who is calling",
 * and refuses to answer anything else. Which school they belong to and what
 * they may do there are resolved from our own tables, because a token body is
 * written by whoever issued it and a membership row is written by us. That is
 * decision 17A, and it is why nothing here reads a tenant or a role claim even
 * though Supabase will happily carry both in `app_metadata`.
 *
 * Fails closed throughout. An unreachable JWKS endpoint, an unknown key, a
 * wrong issuer and an expired token all produce the same outcome: the request
 * is not authenticated. An unverifiable token is not a valid one, which is the
 * same argument the Redis eviction check makes about an unreadable policy.
 */
@Injectable()
export class SupabaseTokenVerifier {
  private readonly logger = new Logger(SupabaseTokenVerifier.name);
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;

  /**
   * `cooldownMs` is injectable only so a test can exercise key rotation without
   * waiting out the throttle. Production uses the default, and the constant is
   * asserted in the suite so lowering it here cannot go unnoticed.
   */
  constructor(jwksUrl: string, issuer: string, cooldownMs: number = JWKS_COOLDOWN_MS) {
    this.issuer = issuer;

    // Lazy: this constructs the fetcher without performing a request, so the
    // application still boots when Supabase is briefly unreachable and fails
    // on the first sign-in attempt instead of refusing to start.
    //
    // jose caches the key set in this process and refetches when it sees an
    // unknown `kid`, with a cooldown so a burst of forged tokens cannot turn
    // into a burst of requests to Supabase. That is decision 14A: the payload
    // is a few hundred bytes, so sharing it through Redis would add a failure
    // mode and a dependency for nothing.
    this.jwks = createRemoteJWKSet(new URL(jwksUrl), {
      cooldownDuration: cooldownMs,
      cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
    });
  }

  /**
   * Returns the caller's identity, or null when the token is not valid.
   *
   * Null rather than a thrown error with a reason, because the caller turns
   * every failure into the same 401. Distinguishing "expired" from "wrong
   * signature" in a response tells an attacker which half of their forgery
   * worked; the real reason is logged here instead.
   */
  async verify(token: string): Promise<VerifiedIdentity | null> {
    let payload: JWTPayload;

    try {
      ({ payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: SUPABASE_AUDIENCE,
        algorithms: PERMITTED_ALGORITHMS,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      }));
    } catch (error) {
      // Debug, not warn. A failed verification is an ordinary event on a public
      // endpoint, and logging every one at warning level turns an expired
      // session into noise that buries the entries that matter.
      this.logger.debug(
        `Token verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      return null;
    }

    const subject = payload.sub;

    if (typeof subject !== 'string' || !UUID_PATTERN.test(subject)) {
      // A structurally valid token whose subject is not a uuid cannot match a
      // membership row, and passing it through would fail later at a cast
      // inside a policy. Refusing here says what is actually wrong.
      this.logger.warn('A token verified but carried a subject that is not a uuid.');

      return null;
    }

    return { userId: subject };
  }
}
