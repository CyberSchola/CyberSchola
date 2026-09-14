import { Global, Module } from '@nestjs/common';

import { AuthGuard } from './auth.guard';
import { SupabaseTokenVerifier } from './token-verifier';

/**
 * Reads the Supabase settings the verifier needs.
 *
 * Read here rather than injected as config because the verifier is constructed
 * once and the values never change at runtime. Validation already happened at
 * boot, in env.validation.ts, so a missing value has stopped the process long
 * before this runs.
 */
function verifier(): SupabaseTokenVerifier {
  const jwksUrl = process.env.SUPABASE_JWKS_URL?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();

  if (!jwksUrl || !supabaseUrl) {
    throw new Error('SUPABASE_URL and SUPABASE_JWKS_URL are required. See .env.example.');
  }

  // Supabase signs access tokens with this issuer. Deriving it from the project
  // URL rather than taking it as its own variable removes a way for the two to
  // disagree, which would reject every token with a confusing error.
  const issuer = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;

  return new SupabaseTokenVerifier(jwksUrl, issuer);
}

/**
 * Authentication.
 *
 * Global because the guard is bound once for the whole application and the
 * verifier has no per-module configuration.
 *
 * This module answers "who is calling" and nothing else. Which school they act
 * in is TenancyModule's question, resolved from our own membership rows rather
 * than from anything the token carries.
 */
@Global()
@Module({
  providers: [{ provide: SupabaseTokenVerifier, useFactory: verifier }, AuthGuard],
  exports: [SupabaseTokenVerifier, AuthGuard],
})
export class AuthModule {}
