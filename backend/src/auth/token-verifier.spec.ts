import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';

import { JWKS_COOLDOWN_MS, SupabaseTokenVerifier } from './token-verifier';

const ISSUER = 'https://project.supabase.co/auth/v1';
const AUDIENCE = 'authenticated';
const SUBJECT = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const KID = 'test-key-1';

/**
 * Verification is tested against real cryptography, never a mock.
 *
 * This is the security control. A mocked verifier would let every case below
 * pass whether the implementation is correct, wrong, or absent entirely, which
 * is exactly the shape of failure this project has already hit twice: a green
 * suite sitting on top of a guarantee that was not there.
 *
 * So the suite generates its own keypair, signs its own tokens and serves its
 * own JWKS over localhost. No network, no Supabase, and the negative cases are
 * genuinely negative: a forged token here is really forged.
 */
describe('SupabaseTokenVerifier', () => {
  let privateKey: KeyLike;
  let publicJwk: JWK;
  /** A key the project never publishes, for the forged-signature case. */
  let foreignKey: KeyLike;
  /** The key the project rotates to, for the rotation case. */
  let rotatedKey: KeyLike;
  let rotatedJwk: JWK;
  let server: Server;
  let jwksUrl: string;

  /** Served by the fake JWKS endpoint. Swapped per test to simulate rotation. */
  let servedKeys: JWK[];
  let requestCount: number;

  // Every keypair this suite needs is generated once, here. RSA-2048 generation
  // is slow enough that doing it inside a test blows Jest's default 5s timeout
  // when the machine is busy running other suites in parallel, which made this
  // file pass alone and fail in a full run. The generous timeout below is for
  // the same reason: the work is real, not a hang.
  beforeAll(async () => {
    const [pair, foreign, rotated] = await Promise.all([
      generateKeyPair('RS256'),
      generateKeyPair('RS256'),
      generateKeyPair('RS256'),
    ]);

    privateKey = pair.privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };

    foreignKey = foreign.privateKey;

    rotatedKey = rotated.privateKey;
    rotatedJwk = {
      ...(await exportJWK(rotated.publicKey)),
      kid: 'test-key-2',
      alg: 'RS256',
      use: 'sig',
    };

    servedKeys = [publicJwk];

    server = createServer((_request, response) => {
      requestCount += 1;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ keys: servedKeys }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    jwksUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/keys`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    servedKeys = [publicJwk];
    requestCount = 0;
  });

  /** A fresh verifier, so one test's key cache cannot mask another's. */
  const verifier = (issuer = ISSUER) => new SupabaseTokenVerifier(jwksUrl, issuer);

  interface TokenOptions {
    subject?: string | null;
    issuer?: string;
    audience?: string;
    expiresIn?: string;
    notBefore?: number;
    kid?: string;
  }

  async function sign(options: TokenOptions = {}): Promise<string> {
    let token = new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: options.kid ?? KID });

    if (options.subject !== null) {
      token = token.setSubject(options.subject ?? SUBJECT);
    }

    token = token
      .setIssuer(options.issuer ?? ISSUER)
      .setAudience(options.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '5m');

    if (options.notBefore !== undefined) {
      token = token.setNotBefore(options.notBefore);
    }

    return token.sign(privateKey);
  }

  describe('a valid token', () => {
    it('returns the subject as the user id', async () => {
      await expect(verifier().verify(await sign())).resolves.toEqual({ userId: SUBJECT });
    });

    it('returns nothing but the identity', async () => {
      // Decision 17A. Tenant and role come from our own rows, so even if a
      // token carried them this class must not surface them.
      const identity = await verifier().verify(await sign());

      expect(Object.keys(identity ?? {})).toEqual(['userId']);
    });
  });

  describe('rejects a token that', () => {
    it('has expired', async () => {
      await expect(verifier().verify(await sign({ expiresIn: '-1m' }))).resolves.toBeNull();
    });

    it('is not valid yet', async () => {
      // Guards against accepting a token minted for the future, which would
      // extend a session beyond what the issuer intended.
      const future = Math.floor(Date.now() / 1000) + 3600;

      await expect(verifier().verify(await sign({ notBefore: future }))).resolves.toBeNull();
    });

    it('comes from another issuer', async () => {
      // A token from a different Supabase project is a perfectly valid token,
      // signed by a real key, for somebody else's system.
      await expect(
        verifier().verify(await sign({ issuer: 'https://attacker.supabase.co/auth/v1' })),
      ).resolves.toBeNull();
    });

    it('is addressed to another audience', async () => {
      await expect(verifier().verify(await sign({ audience: 'anon' }))).resolves.toBeNull();
    });

    it('is signed with a key the project does not publish', async () => {
      const forged = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: KID })
        .setSubject(SUBJECT)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(foreignKey);

      await expect(verifier().verify(forged)).resolves.toBeNull();
    });

    it('is not a JWT at all', async () => {
      await expect(verifier().verify('not-a-token')).resolves.toBeNull();
    });

    it('carries a subject that is not a uuid', async () => {
      // A structurally valid token whose subject cannot match a membership row.
      // Letting it through would fail later at a cast inside a policy.
      await expect(verifier().verify(await sign({ subject: 'admin' }))).resolves.toBeNull();
    });

    it('carries no subject at all', async () => {
      await expect(verifier().verify(await sign({ subject: null }))).resolves.toBeNull();
    });
  });

  describe('algorithm confusion', () => {
    it('refuses a token signed HS256 with the public key as the secret', async () => {
      // The classic attack on a JWKS-backed verifier. A verifier that trusts
      // the token's own `alg` header treats the published public key as an HMAC
      // secret and validates a token anyone could mint.
      const secret = Buffer.from(JSON.stringify(publicJwk));
      const forged = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256', kid: KID })
        .setSubject(SUBJECT)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(secret);

      await expect(verifier().verify(forged)).resolves.toBeNull();
    });

    it('refuses an unsigned token', async () => {
      // alg: none, assembled by hand because no library will sign it.
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
        sub: SUBJECT,
        iss: ISSUER,
        aud: AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 300,
      })}.`;

      await expect(verifier().verify(unsigned)).resolves.toBeNull();
    });
  });

  describe('key handling', () => {
    it('caches the key set rather than fetching per request', async () => {
      const single = verifier();

      await single.verify(await sign());
      await single.verify(await sign());
      await single.verify(await sign());

      expect(requestCount).toBe(1);
    });

    it('throttles refetching by default, so bad tokens cannot stampede Supabase', () => {
      // Asserted rather than left implicit: the rotation test below passes a
      // cooldown of zero, and without this nothing would notice if the real
      // default were lowered to match it.
      expect(JWKS_COOLDOWN_MS).toBe(30_000);
    });

    it('picks up a rotated key without a restart', async () => {
      // Cooldown of zero so the refetch is not throttled. The mechanism under
      // test is "unknown kid triggers a refetch", which is identical either
      // way; only the throttle differs.
      const single = new SupabaseTokenVerifier(jwksUrl, ISSUER, 0);
      await single.verify(await sign());

      // Supabase rotates: a new key, a new kid, the old one withdrawn.
      servedKeys = [rotatedJwk];

      const newToken = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key-2' })
        .setSubject(SUBJECT)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(rotatedKey);

      await expect(single.verify(newToken)).resolves.toEqual({ userId: SUBJECT });
    });

    it('fails closed when the key endpoint is unreachable', async () => {
      // Not "allow through because we could not check". An unverifiable token
      // is not a valid one, the same argument the Redis eviction check makes
      // about a policy it cannot read.
      const unreachable = new SupabaseTokenVerifier('http://127.0.0.1:1/keys', ISSUER);

      await expect(unreachable.verify(await sign())).resolves.toBeNull();
    });
  });
});
