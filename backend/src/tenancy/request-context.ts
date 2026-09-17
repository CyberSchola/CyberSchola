import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { toRole, type Role } from '../auth/permission.matrix';

/**
 * Everything security-relevant about the caller, resolved once per request.
 *
 * Blueprint rule 24: none of this is ever read from a request body or a query
 * string. `tenantId` and `role` come from a membership lookup against our own
 * tables, and the token supplies only an identity to look up.
 *
 * `tenantId` is optional, and that is not laxity. There is a real and narrow
 * case for a context with a user and no school: a signed-in person asking
 * which schools they belong to, before they have chosen one. Making that
 * representable is what keeps it from being forced through a public route
 * instead, which would drop authentication entirely. Anything that needs a
 * school calls `requireTenantId`, which throws rather than returning undefined.
 */
export interface RequestContext {
  /**
   * How this context came to exist.
   *
   * Recorded rather than inferred, because the two paths are authorized in
   * completely different ways and an audit line that cannot tell them apart is
   * not much of an audit line. See "How a context comes to exist" below for the
   * contract each one carries.
   */
  readonly origin: 'http' | 'job';
  /** The school this request acts within, if one has been chosen. */
  readonly tenantId?: string;
  /** Who is acting, from a verified token subject, or the actor a job runs as. */
  readonly userId?: string;
  /** The caller's role in this school, from the membership row. */
  readonly role?: string;
  /** Correlates log lines for one request. */
  readonly requestId: string;
  /** For a job context, what work it is. Absent on an HTTP request. */
  readonly jobName?: string;
}

/**
 * Carries the context through the async call stack.
 *
 * AsyncLocalStorage rather than a request-scoped provider, deliberately.
 * Nest's `Scope.REQUEST` re-instantiates the entire dependency chain of any
 * provider that injects a request-scoped one, which quietly makes every
 * service in that chain request-scoped too. That is a real per-request cost,
 * and worse it is invisible: nothing tells you it happened.
 *
 * The storage itself is module-private. A context can only be opened through
 * the two functions below, and each of those has exactly one caller in
 * application code.
 */
const storage = new AsyncLocalStorage<RequestContext>();

/**
 * # How a context comes to exist
 *
 * A context is what every tenant-scoped action trusts, so whoever opens one is
 * asserting who is asking, in which school, as what. There are exactly two
 * places allowed to make that assertion, and each makes it only after the
 * database has confirmed it:
 *
 *     HTTP request    TenantContextInterceptor, after the token is verified and
 *                     the membership resolved   -> runWithRequestContext
 *     Background job  JobContextService.runAsMember, after the membership and
 *                     role are read from the database -> enterVerifiedJobContext
 *
 * Nothing else may call either function. TypeScript cannot make an exported
 * function unreachable from other files, so this is enforced three ways, none
 * of which relies on a comment being read:
 *
 * 1. ESLint `no-restricted-imports` refuses to let any other file in `src`
 *    import them (see `eslint.config.mjs`).
 * 2. `context-entry-points.spec.ts` scans the source and fails the unit suite if
 *    any other file references them, whatever the lint configuration says.
 * 3. Each function refuses the other's kind of context at runtime.
 *
 * There is deliberately no function that takes a tenant, an actor and a role
 * from a caller and opens a job context with them. An earlier version exported
 * one (`runInJobContext`), and review rightly pointed out that a future worker
 * could call it directly and establish an unverified tenant context. A worker
 * now has one door: `JobContextService.runAsMember`, which accepts a school and
 * an actor and reads everything else from the database.
 *
 * Test files are exempt and build contexts directly, because a fixture context
 * is how a unit of scoping logic is tested in isolation. That is a test
 * constructing a precondition, not application code establishing identity.
 */

/**
 * Runs `work` inside an HTTP request context.
 *
 * **Only `TenantContextInterceptor` calls this.** It refuses a job context, so
 * it cannot be used to fabricate background authorization either.
 */
export function runWithRequestContext<T>(context: RequestContext, work: () => T): T {
  if (context.origin !== 'http') {
    throw new Error(
      'runWithRequestContext opens HTTP request contexts only. Background work must go through ' +
        "JobContextService.runAsMember, which verifies the actor's membership first.",
    );
  }

  return storage.run(context, work);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The facts a job context is built from, as `JobContextService` read them from
 * the database. Not a request from a caller.
 */
export interface VerifiedJobActor {
  /** What this work is, for the audit trail. */
  readonly jobName: string;
  /** The school, as confirmed by a live membership row. */
  readonly tenantId: string;
  /** The person the job acts as. */
  readonly userId: string;
  /** The live membership that proved the actor belongs to the school. */
  readonly membershipId: string;
  /** The role read off that membership row. */
  readonly role: Role;
}

/**
 * Runs `work` inside a background job context.
 *
 * **Only `JobContextService.runAsMember` calls this**, with values it has just
 * read from the database. It is not an entry point for jobs; `runAsMember` is.
 *
 * It still validates what it is given, so that a mistake inside the verified
 * path fails closed rather than producing a malformed context: a blank job
 * name, a non-uuid id, a missing membership id, or a role the matrix does not
 * recognise are all refused.
 *
 * ## Why jobs need a context at all
 *
 * HTTP requests and background jobs are authorized by different means, and the
 * difference has to be explicit or it becomes an assumption:
 *
 *     HTTP request
 *       -> authentication (AuthGuard, verified Supabase token)
 *       -> tenant resolution (membership lookup under RLS)
 *       -> route permission (PermissionInterceptor)
 *       -> access scope (TenantScopedAction)
 *       -> row-level security
 *
 *     Background job
 *       -> JobContextService.runAsMember (membership verified, role read)
 *       -> access scope (TenantScopedAction)
 *       -> row-level security
 *
 * The route permission step is absent from the second path because there is no
 * route, and its absence grants nothing: a job that has not been through
 * `runAsMember` has no context, and `TenantScopedAction` throws without one.
 */
export function enterVerifiedJobContext<T>(actor: VerifiedJobActor, work: () => T): T {
  if (actor.jobName.trim() === '') {
    throw new Error('A job context needs a jobName, so an audit line can say what ran.');
  }

  if (!UUID_PATTERN.test(actor.tenantId)) {
    throw new Error('Refusing to open a job context for a non-uuid tenant id.');
  }

  if (!UUID_PATTERN.test(actor.userId)) {
    throw new Error('Refusing to open a job context for a non-uuid user id.');
  }

  if (!UUID_PATTERN.test(actor.membershipId)) {
    throw new Error(
      'Refusing to open a job context without the membership that verified it. ' +
        'Use JobContextService.runAsMember.',
    );
  }

  if (toRole(actor.role) === undefined) {
    // Fails closed on a role the matrix does not know, exactly as the request
    // path does. A job must not be the way an unrecognised role gets in.
    throw new Error(`Refusing to open a job context with the unrecognised role "${actor.role}".`);
  }

  return storage.run(
    {
      origin: 'job',
      jobName: actor.jobName,
      tenantId: actor.tenantId,
      userId: actor.userId,
      role: actor.role,
      requestId: randomUUID(),
    },
    work,
  );
}

/**
 * The current context, or undefined outside a request.
 *
 * Undefined is a legitimate answer: the worker process, a migration and a
 * startup hook all run outside any request. Callers that require a tenant use
 * `requireTenantId` instead, so the absence is handled explicitly rather than
 * by an optional chain that silently does nothing.
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * The current tenant, or an error.
 *
 * Throws rather than returning undefined on purpose. A caller reaching for a
 * tenant id has already decided it needs one, and the alternative is a query
 * that silently runs unscoped. Failing loudly here is the difference between a
 * bug and a data leak.
 */
export function requireTenantId(): string {
  const context = storage.getStore();

  if (!context) {
    throw new Error(
      'No request context is in scope. Tenant-scoped work must run inside a request, ' +
        'or inside an explicitly opened tenant context (see TenantTransactionService). ' +
        'A job payload must carry its own tenant id, because a worker has no request.',
    );
  }

  if (context.tenantId === undefined) {
    // A context exists, so this is an authenticated request; it simply has no
    // school chosen. Reaching a tenant-scoped query from such a route is a
    // routing mistake rather than a missing context, and the two deserve
    // different messages.
    throw new Error(
      'The request context has no tenant. This route resolved a user but no school, ' +
        'which is the @TenantOptional() path. Tenant-scoped work does not belong here.',
    );
  }

  return context.tenantId;
}

/**
 * The current user, or an error.
 *
 * The same argument as `requireTenantId`: code that asks for the caller has
 * already decided it needs one, and the alternative is an optional chain that
 * silently treats "nobody" as an ordinary value.
 */
export function requireUserId(): string {
  const context = storage.getStore();

  if (!context?.userId) {
    throw new Error(
      'No authenticated user is in scope. A route that reads the caller must be ' +
        'authenticated, and a worker job must carry its own actor in the payload.',
    );
  }

  return context.userId;
}
