/**
 * PRISMA CONFIG: Prisma Configuration File
 *
 * Purpose:
 * This file configures Prisma's behavior and loads environment variables.
 * It ensures DATABASE_URL from .env is available for Prisma operations.
 *
 * Why We Need This:
 * - By default, Prisma only loads .env when running CLI commands
 * - When next.config.ts or other config files exist, Prisma skips auto-loading
 * - This config file explicitly loads .env so environment variables work
 *
 * What Happens:
 * 1. Load .env file using dotenv package
 * 2. Make DATABASE_URL available as an environment variable
 * 3. Define schema location (./prisma/schema.prisma)
 * 4. Prisma CLI can then access DATABASE_URL for migrations
 *
 * Future: When upgrading to Prisma 7+, this is where you'll move the
 * datasource URL from schema.prisma. The structure is ready for that transition.
 */

import { config as loadEnv } from "dotenv";

// Load environment variables explicitly when a Prisma config file exists.
// When Prisma detects a `prisma.config.ts`, it skips automatic `.env` loading,
// so we load it here to make environment variables work.
//
// This is essential because:
// - next.config.mjs exists in this project
// - When next.config exists, Prisma doesn't auto-load .env
// - Without this, DATABASE_URL would be undefined
// - Prisma CLI needs access to the database URL
loadEnv({ path: ".env" });

import { defineConfig } from "@prisma/config";

/**
 * Prisma Configuration
 *
 * Options:
 * - schema: Path to the Prisma schema file (./prisma/schema.prisma)
 *
 * Note on datasources:
 * - Prisma 6: URL lives in schema.prisma with env("DATABASE_URL")
 * - Prisma 7+: URL moves here to prisma.config.ts (when supported)
 *
 * Your setup is compatible with both versions:
 * The environment loading here makes schema.prisma's env() work.
 */
export default defineConfig({
  schema: "./prisma/schema.prisma",
});
