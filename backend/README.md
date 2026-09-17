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

**A platform super admin is an application role, never a database one.** CyberSchola will need cross-tenant operations eventually: platform administration, support tooling, AI and RAG jobs that span schools, quota management. None of that may be implemented by granting the application's database role `SUPERUSER` or `BYPASSRLS`. Those attributes switch off every policy for every query that role makes, including ordinary request traffic, and the test suite stays green while it happens. A platform-level privilege is resolved in application authorization and carried out through explicit, audited, tenant-scoped operations, so `cyberschola_app` stays restricted no matter who is signed in.

**Background jobs are authorized differently from requests, and explicitly.** An HTTP request is authorized by authentication, then tenant resolution, then a route permission, then the access scope, then row-level security. A background job has no route, so the route permission step does not apply to it and the HTTP permission interceptor skips non-HTTP execution entirely. That skip grants nothing: a job reaches tenant data only through `JobContextService.runAsMember`, which reads the actor's membership of the named school and takes the roles from its role rows. It is the job-side twin of the request resolver, and for the same reason: naming a school has to be a selection from what the database confirms, never an assertion. A job cannot point at a school its actor does not belong to, and cannot claim a role its actor does not hold. A worker that bypassed the permission interceptor bypassed a check that never applied to it, and still cannot read a row. There is no lower-level door: the two functions that open a context each have exactly one caller, the request interceptor and `runAsMember`, and an ESLint rule and a source-scanning unit test fail the build if any other file reaches for them.

**A tenant-owned table is one that has been through `apply_tenant_isolation`.** That function enables and forces row-level security, creates the policy, and issues the application role's grant, in that order and as one call. The application is granted nothing on new tables by default, so a migration that creates a table with a `tenant_id` column and forgets the call produces a permission error the first time the table is touched, rather than a table every school can read. `test/schema-conformance.integration-spec.ts` fails the build if any table with a `tenant_id` column is missing its policy.

**A reference between two schools' tables carries the school.** Postgres checks a foreign key without row-level security, so a plain `class_id REFERENCES classes(id)` lets one school's row point at another school's class, and nothing in the policies notices. Every foreign key between tenant-owned tables is therefore composite, `(tenant_id, class_id) REFERENCES classes(tenant_id, id)`, which makes a cross-school reference impossible to store. The schema conformance suite fails the build on any that is not.

**A role is a row, and a person can hold several.** Being a teacher in a school means having a live `teachers` row linked to your membership, and the same for `students`, `parents`, `staff` and `school_admins`. The `membership_roles` view reads them back. A teacher whose child attends the same school holds both roles on one membership: permissions are the union of their roles, and each access scope ORs one branch per role. Records exist before logins do, so a school can enrol a class of children who will never sign in, and an administrator links a login to a record when there is one.

**Every view runs as its caller.** A Postgres view executes with its owner's privileges by default, and the migration role that owns our views bypasses row-level security. So every view is created `WITH (security_invoker = true)`, and the schema conformance suite fails the build on any that is not.

**A record that must not change silently is guarded by the database, not by a method.** Attendance is one table for students, teachers and staff, and a status on it cannot be changed without a reason: a trigger writes the previous status, the new one, the actor and the reason into `attendance_corrections`, and refuses the update when the transaction carries no reason. The application role holds SELECT and INSERT on that trail and nothing else, so the thing being audited cannot edit its own audit. A service method writing the history row beside the update would have been correct until the second write path existed, and this codebase has already produced three defects of exactly that shape: a guarantee described in a comment that nothing ever enforced.

**A shared table with several kinds of subject still carries real foreign keys.** Attendance names a student, a teacher or a staff member, and the obvious shape, one `user_id` column plus a type, can carry no foreign key at all, which is the hole that lets one school's row point at another school's record. So the subject is three nullable columns, one per kind, each with its own composite key, and a check constraint that exactly one is set and matches the type. Postgres validates a multi-column foreign key only when every column in it is non-null, so the two unused columns cost nothing and the one in use is fully checked.

**Denormalised context is made unfalsifiable rather than merely copied.** A student's attendance carries the class, session and term, because reports group by them and because last year's record must not re-report under this year's class. The foreign key points at the enrolment, through `(tenant_id, enrolment_id, class_id, session_id, student_id)`, so the database can only satisfy it from a real enrolment: a record cannot claim a child was in a class they were never in. The key it references is an existing unique key extended with the columns we want guaranteed, which makes it unique by construction and keeps it clear of the partial indexes that soft delete requires.

## Layout

```
src/
├── main.ts          HTTP entry point
├── app.module.ts    root module
└── health/          liveness probe
```

Modules arrive in dependency order: tenancy, then identity, then the academic spine, then people, then school operations. A module is not started before the relationships underneath it are stable. Attendance is the first of the school operations modules, and it sits on all four: a register is recorded against the enrolment that places a child in a class, and who may take or read one is decided by the role rows and the access scopes the people module owns.

## Contributing

Branches are cut from `develop` and named `<type>/<TICKET>-<summary>`, for example `feat/BE-F01-backend-project-scaffold`. Commits follow Conventional Commits with the ticket closing the subject line, and CI rejects anything else.

Every pull request states its acceptance criteria coverage, names what it deliberately defers and where that work lands, and carries Swagger and curl evidence as PNG. Endpoints are verified three ways before a pull request opens: the test suites, Swagger UI, and curl.
