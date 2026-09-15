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
   * not much of an audit line. See the note above `runInJobContext` for the
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
 * The storage is module-private. Nothing outside this file may `enterWith` or
 * `run`, so a context cannot be forged from application code.
 */
const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `work` with the given context in scope.
 *
 * Only the interceptor calls this. Everything else reads.
 */
export function runWithRequestContext<T>(context: RequestContext, work: () => T): T {
  return storage.run(context, work);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Opens a context for trusted background work.
 *
 * **Prefer `JobContextService.runAsMember`.** This is the low-level primitive
 * and it takes the role on trust, which means a caller supplying one has
 * asserted it rather than proved it. A test caught what that allows: a job
 * naming any school could read it, because nothing checked its actor belonged
 * there. `JobContextService` reads the membership first and takes the role off
 * that row, which is the same selection-not-assertion rule the HTTP resolver
 * follows. Call this directly only where the membership is already established.
 *
 * ## The security boundary this exists to draw
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
 *     Trusted background job
 *       -> this function, called deliberately with a tenant and an actor
 *       -> access scope (TenantScopedAction)
 *       -> row-level security
 *
 * The route permission step is absent from the second path because there is no
 * route. That is not a gap, and this is the part worth being precise about:
 * **the HTTP permission interceptor is not the authorization boundary for
 * background work.** It skips non-HTTP execution because it has nothing to read,
 * and skipping it grants nothing, because a job that has not opened a context
 * here cannot reach tenant data at all. `TenantScopedAction` demands a tenant
 * and a recognised role from the context and throws without them, so the
 * failure is a thrown error rather than an unscoped query.
 *
 * A job therefore has to say who it is acting as, in the same terms a request
 * would: a school, an actor, and a role. It gains nothing by being a job. What
 * it does gain is a recorded reason, in `jobName`, so an audit can tell a
 * scheduled report apart from a person.
 *
 * ## What this deliberately does not do
 *
 * It does not consult the permission matrix. A job is trusted code we wrote,
 * not a caller, and the matrix answers a question about callers. The access
 * scope still applies, so a job acting as a teacher sees what that teacher
 * would see. When queue jobs arrive in P8, a job payload carries its own tenant
 * and actor precisely so this call can be made honestly rather than defaulted.
 */
export function runInJobContext<T>(
  job: {
    /** What this work is, for the audit trail. */
    readonly jobName: string;
    /** The school the job acts within. */
    readonly tenantId: string;
    /** The person the job acts as. Jobs act as somebody, never as nobody. */
    readonly userId: string;
    /** Their role, which the access scope will narrow by. */
    readonly role: Role;
  },
  work: () => T,
): T {
  if (job.jobName.trim() === '') {
    throw new Error('A job context needs a jobName, so an audit line can say what ran.');
  }

  if (!UUID_PATTERN.test(job.tenantId)) {
    throw new Error('Refusing to open a job context for a non-uuid tenant id.');
  }

  if (!UUID_PATTERN.test(job.userId)) {
    throw new Error('Refusing to open a job context for a non-uuid user id.');
  }

  if (toRole(job.role) === undefined) {
    // Fails closed on a role the matrix does not know, exactly as the request
    // path does. A job must not be the way an unrecognised role gets in.
    throw new Error(
      `Refusing to open a job context with the unrecognised role "${job.role}". ` +
        'Jobs act as a known role so the access scope can narrow their reads.',
    );
  }

  return storage.run(
    {
      origin: 'job',
      jobName: job.jobName,
      tenantId: job.tenantId,
      userId: job.userId,
      role: job.role,
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
