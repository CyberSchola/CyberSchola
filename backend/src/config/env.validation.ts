import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsString, Matches, Max, Min, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

/**
 * Environment the application currently reads.
 *
 * Only variables that are actually used appear here. The Supabase, database
 * and Redis variables documented in .env.example are validated in BE-F03,
 * when the modules that consume them exist. Declaring them required now would
 * mean every developer needs a database before the process will boot, which
 * is false today.
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

  return validated;
}
