import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

/**
 * Environment the application currently reads.
 *
 * Only variables that are actually used appear here. The Supabase, LiveKit and
 * Paystack variables documented in .env.example are validated when the modules
 * that consume them exist, rather than being declared required before anything
 * reads them.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv, {
    message: `NODE_ENV must be one of: ${Object.values(NodeEnv).join(', ')}`,
  })
  NODE_ENV!: NodeEnv;

  @IsInt({ message: 'PORT must be an integer' })
  @Min(1, { message: 'PORT must be between 1 and 65535' })
  @Max(65535, { message: 'PORT must be between 1 and 65535' })
  PORT!: number;

  @IsString()
  @Matches(/^[a-z0-9]+(?:\/[a-z0-9]+)*$/, {
    message: 'API_PREFIX must be a slash-separated path with no leading or trailing slash',
  })
  API_PREFIX!: string;

  /**
   * Server-side key for the Groq AI provider.
   *
   * \S rather than .+ : a whitespace-only value would pass a bare presence
   * check and fail confusingly inside the Groq SDK instead of at boot.
   */
  @IsString()
  @Matches(/\S/, { message: 'GROQ_API_KEY must not be empty or whitespace-only' })
  GROQ_API_KEY!: string;

  /**
   * Transaction-mode pooler, used by the application.
   *
   * Validated as a postgres URL rather than merely present. A blank or
   * malformed value would otherwise surface as a driver error on the first
   * request, long after whoever set it has moved on.
   */
  @IsString()
  @Matches(/^postgres(ql)?:\/\/.+/, {
    message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
  })
  DATABASE_URL!: string;

  /**
   * Session-mode pooler, used only by migrations.
   *
   * Optional, because a local Postgres has no separate session endpoint and
   * the migration data source falls back to DATABASE_URL. Against Supabase it
   * must be set, or migrations run through the transaction pooler and their
   * advisory locks land on whichever backend answers next.
   */
  @IsOptional()
  @IsString()
  @Matches(/^postgres(ql)?:\/\/.+/, {
    message: 'DIRECT_URL must be a postgres:// or postgresql:// connection string',
  })
  DIRECT_URL?: string;

  /**
   * Exact strings only.
   *
   * `IsBooleanString` would also accept "1" and "0", and the data source reads
   * this as `=== 'true'`. So `DATABASE_SSL=1` would pass validation, look like
   * it enabled TLS, and silently connect to Supabase without it. The validator
   * has to agree with the consumer, not merely be in the same spirit.
   */
  @IsIn(['true', 'false'], { message: 'DATABASE_SSL must be exactly "true" or "false"' })
  DATABASE_SSL!: string;

  @IsInt({ message: 'DATABASE_POOL_MAX must be an integer' })
  @Min(1, { message: 'DATABASE_POOL_MAX must be between 1 and 100' })
  @Max(100, { message: 'DATABASE_POOL_MAX must be between 1 and 100' })
  DATABASE_POOL_MAX!: number;

  /**
   * Redis, used for caching now and for quotas, rate limits and queues later.
   *
   * Required rather than optional: the readiness probe treats Redis being down
   * as not-ready, because it will hold the rate limit and AI quota counters.
   * Booting without it would mean serving traffic with those controls absent,
   * which fails open.
   */
  @IsString()
  @Matches(/^rediss?:\/\/.+/, {
    message: 'REDIS_URL must be a redis:// or rediss:// connection string',
  })
  REDIS_URL!: string;

  /**
   * Accepts a Redis whose eviction policy we cannot read.
   *
   * Some managed providers disable CONFIG GET entirely, so the boot check
   * cannot verify that maxmemory-policy is noeviction. The default is to
   * refuse to start, because an invariant that was never checked is not an
   * invariant that holds, and the counters it protects fail open when evicted.
   *
   * Setting this to "true" records that the guarantee is being made outside
   * this application. It does not disable the check: a policy we can read and
   * know to be evicting still refuses to boot.
   *
   * Validated with IsIn rather than a boolean-ish check on purpose. DATABASE_SSL
   * once accepted "1" through IsBooleanString while the code compared against
   * "true", so it silently ran without TLS. Only the two exact strings pass.
   */
  @IsOptional()
  @IsIn(['true', 'false'], {
    message: 'REDIS_ALLOW_UNKNOWN_EVICTION_POLICY must be exactly "true" or "false"',
  })
  REDIS_ALLOW_UNKNOWN_EVICTION_POLICY?: string;

  /**
   * The Supabase project URL.
   *
   * Required rather than optional: authentication is not something the
   * application can degrade without. Booting without it would mean every route
   * either rejecting everyone or, far worse, someone later "temporarily"
   * disabling the guard to get past it.
   *
   * The token issuer is derived from this rather than configured separately,
   * so the two cannot disagree.
   */
  @IsString()
  @Matches(/^https:\/\/.+/, { message: 'SUPABASE_URL must be an https:// URL' })
  SUPABASE_URL!: string;

  /** Where the project publishes the public keys its tokens are signed with. */
  @IsString()
  @Matches(/^https:\/\/.+/, { message: 'SUPABASE_JWKS_URL must be an https:// URL' })
  SUPABASE_JWKS_URL!: string;

  /**
   * Browser origins allowed to call the API, comma-separated, such as
   * `https://app.example.com,http://localhost:3001`.
   *
   * Absent means no cross-origin browser access at all, which is the right
   * default for an API that only servers and its own documentation call. Each
   * entry is an exact origin: a scheme, a host and an optional port, with no
   * path and no wildcard, because a pattern here is how a lookalike domain
   * gets in.
   */
  @IsOptional()
  @Matches(/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?(,https?:\/\/[a-z0-9.-]+(:\d{1,5})?)*$/, {
    message:
      'CORS_ORIGINS must be a comma-separated list of exact origins such as ' +
      'https://app.example.com, with no paths, spaces or wildcards',
  })
  CORS_ORIGINS?: string;
}

/**
 * Where a production token may come from.
 *
 * Staging may trust its own demo issuer, so a public demo can hand out tokens
 * for demo accounts. Production must never be configured that way, so this
 * refuses to boot unless both the issuer and its keys belong to a Supabase
 * project. It is what keeps the demo sign-in a staging-only thing: the code
 * that mints demo tokens is not in this application at all, and this makes
 * sure no production configuration can point the application at it.
 */
const SUPABASE_PROJECT = /^https:\/\/[a-z0-9]+\.supabase\.co(\/|$)/;

function assertProductionIssuer(config: EnvironmentVariables): void {
  if (config.NODE_ENV !== NodeEnv.Production) {
    return;
  }

  for (const [name, value] of [
    ['SUPABASE_URL', config.SUPABASE_URL],
    ['SUPABASE_JWKS_URL', config.SUPABASE_JWKS_URL],
  ] as const) {
    if (!SUPABASE_PROJECT.test(value)) {
      throw new Error(
        `Invalid environment configuration:\n  - In production, ${name} must be a ` +
          'Supabase project URL (https://<project>.supabase.co). Tokens from any other ' +
          'issuer, including the staging demo sign-in, are never trusted in production.',
      );
    }
  }
}

/** The allowed browser origins, parsed. Empty when none are configured. */
export function corsOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Treats a blank value as absent.
 *
 * dotenv turns `NAME=` in a .env file into the empty string, not undefined, and
 * class-validator's @IsOptional only skips null and undefined. Without this a
 * developer who copies .env.example verbatim and leaves an optional variable
 * blank gets a startup failure telling them the value is malformed, which is
 * both wrong and confusing: they did not set it at all.
 *
 * This mirrors the same helper in data-source.ts, where the identical blank
 * handling was already needed for the driver options.
 */
function optional(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() === ''
    ? undefined
    : (value as string | undefined);
}

/**
 * Validates the environment at boot and stops the process if it is wrong.
 *
 * Failing here is the point. A missing or malformed variable that is only
 * noticed on the first request fails in front of a user, in production, with a
 * confusing error. Failing at startup fails in front of whoever is deploying.
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(
    EnvironmentVariables,
    {
      NODE_ENV: config.NODE_ENV ?? NodeEnv.Development,
      PORT: config.PORT ?? 3000,
      API_PREFIX: config.API_PREFIX ?? 'api/v1',
      DATABASE_URL: config.DATABASE_URL,
      DIRECT_URL: optional(config.DIRECT_URL),
      DATABASE_SSL: config.DATABASE_SSL ?? 'false',
      DATABASE_POOL_MAX: config.DATABASE_POOL_MAX ?? 10,
      REDIS_URL: config.REDIS_URL,
      REDIS_ALLOW_UNKNOWN_EVICTION_POLICY: optional(config.REDIS_ALLOW_UNKNOWN_EVICTION_POLICY),
      SUPABASE_URL: config.SUPABASE_URL,
      SUPABASE_JWKS_URL: config.SUPABASE_JWKS_URL,
      CORS_ORIGINS: optional(config.CORS_ORIGINS),
      GROQ_API_KEY: config.GROQ_API_KEY,
    },
    { enableImplicitConversion: true },
  );

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
  });

  if (errors.length > 0) {
    const problems = errors
      .flatMap((error) => Object.values(error.constraints ?? {}))
      .map((problem) => `  - ${problem}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  assertProductionIssuer(validated);

  return validated;
}
