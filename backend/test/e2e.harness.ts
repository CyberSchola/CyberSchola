// Must come first: see the module for why.
import { APP_ROLE_PASSWORD } from './app-database.env';

import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { DataSource } from 'typeorm';
// Namespace import with a runtime unwrap: supertest is CommonJS with a default
// export and this tsconfig has esModuleInterop off.
import * as supertestModule from 'supertest';

import { AppModule } from '../src/app.module';
import { SupabaseTokenVerifier } from '../src/auth/token-verifier';
import { createTestDataSource, resetSchema } from './database.setup';

type SupertestFn = typeof supertestModule;
const maybeWrapped = supertestModule as unknown as { default?: SupertestFn };
export const request: SupertestFn = maybeWrapped.default ?? supertestModule;

const ISSUER = 'https://e2e-placeholder.supabase.co/auth/v1';
const KID = 'e2e-key';

/** A running application and what a suite needs to drive it. */
export interface E2eHarness {
  /** The migration role, for seeding and for checking what the database holds. */
  readonly owner: DataSource;
  readonly app: INestApplication;
  server(): Server;
  /** An `Authorization` header value carrying a freshly signed token for a user. */
  bearer(userId: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * Boots the real application against a freshly migrated database.
 *
 * Real guard, real verifier doing real ES256 checks, Postgres as
 * `cyberschola_app`. The only substitution is where keys come from: a local JWKS
 * served from a keypair generated here. Asserts the connecting role before
 * returning, because a suite whose app is not the restricted role proves nothing
 * about the tenant boundary.
 *
 * Import this module first in a spec, before anything from `src`, so that
 * `app-database.env` sets DATABASE_URL before the data source module loads.
 */
export async function startE2e(
  seed: (owner: DataSource) => Promise<void>,
  extraImports: NonNullable<ModuleMetadata['imports']> = [],
): Promise<E2eHarness> {
  const pair = await generateKeyPair('ES256');
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' };
  const keyServer = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve) => keyServer.listen(0, '127.0.0.1', resolve));
  const jwksUrl = `http://127.0.0.1:${(keyServer.address() as AddressInfo).port}/keys`;

  const owner = createTestDataSource();
  await owner.initialize();
  await resetSchema(owner);
  await owner.runMigrations({ transaction: 'all' });
  await owner.query(`ALTER ROLE cyberschola_app WITH PASSWORD '${APP_ROLE_PASSWORD}'`);
  await seed(owner);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule, ...extraImports] })
    .overrideProvider(SupabaseTokenVerifier)
    .useValue(new SupabaseTokenVerifier(jwksUrl, ISSUER))
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();

  const [{ role }] = await app
    .get(DataSource)
    .query<Array<{ role: string }>>('SELECT current_user AS role');

  if (role !== 'cyberschola_app') {
    throw new Error(
      `The e2e app connected as "${role}", not cyberschola_app. Nothing here would be proven.`,
    );
  }

  return {
    owner,
    app,
    server: () => app.getHttpServer() as Server,
    bearer: async (userId) =>
      `Bearer ${await new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: KID })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(pair.privateKey)}`,
    close: async () => {
      await app.close();
      await owner.destroy();
      await new Promise<void>((resolve) => keyServer.close(() => resolve()));
    },
  };
}
