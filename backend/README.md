# CyberSchola Backend

Multi-tenant API for the CyberSchola school management platform. NestJS, TypeORM and Redis, against Supabase Postgres.

The frontend application lives at the repository root and is a separate package. This directory has its own `package.json`, its own lockfile and its own build, and the two do not share dependencies.

## Requirements

- Node 22 (see `.nvmrc`). Node 23 is not supported, as it never becomes an LTS release.
- pnpm 10
- Docker, for the local Postgres and Redis used by the integration tests

## Setup

```bash
cd backend
cp .env.example .env   # then fill in the values
pnpm install --frozen-lockfile
pnpm start:dev
```

`GET /api/v1/health` answers once the process is up.

Installs are always frozen. If a dependency needs to change, edit `package.json`, run a resolving install once, review the lockfile diff and the install hooks of anything new, then commit the lockfile with the change.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm start:dev` | API with watch mode |
| `pnpm build` | Compile to `dist/` |
| `pnpm lint:check` | ESLint, no autofix |
| `pnpm format:check` | Prettier, no writes |
| `pnpm test` | Unit tests |
| `pnpm test:cov` | Unit tests with coverage |

## Architecture

Twenty decisions were settled before the first commit and they are binding on this codebase. The four that shape nearly every file:

**Tenant isolation is enforced twice.** A tenant-scoped base action injects the predicate on every query, and Postgres row-level security backs it at the database. Neither is a substitute for the other.

**The connecting role matters.** The API connects as a role without `BYPASSRLS`, against tables that have `FORCE ROW LEVEL SECURITY`. Connecting with the service role key or the `postgres` role disables every policy while leaving the test suite green, so that configuration is a defect even though nothing fails.

**Tenant and role never come from a token.** Supabase Auth answers who the user is. Which school they belong to and what they may do is resolved from the membership table on every request.

**Authorization is computed, not cached.** The teacher access rule exists once, as a composable query fragment, so a class reassignment takes effect on the next request rather than when a cache expires.

## Layout

```
src/
├── main.ts          HTTP entry point
├── app.module.ts    root module
└── health/          liveness probe
```

Modules arrive in dependency order: tenancy, then identity, then the academic spine, then people, then school operations. A module is not started before the relationships underneath it are stable.

## Contributing

Branches are cut from `develop` and named `<type>/<TICKET>-<summary>`, for example `feat/BE-F01-backend-project-scaffold`. Commits follow Conventional Commits with the ticket closing the subject line, and CI rejects anything else.

Every pull request states its acceptance criteria coverage, names what it deliberately defers and where that work lands, and carries Swagger and curl evidence as PNG. Endpoints are verified three ways before a pull request opens: the test suites, Swagger UI, and curl.
