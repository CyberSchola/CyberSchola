import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Everything security-relevant about the caller, resolved once per request.
 *
 * Blueprint rule 24: none of this is ever read from a request body or a query
 * string. `tenantId` and `role` come from a membership lookup against our own
 * tables, and the token supplies only an identity to look up.
 *
 * `role` and `permissions` are declared but not populated until BE-A01, where
 * authentication lands. They are here now so that the shape does not change
 * underneath the guard, the actions and the conformance suite once it does.
 */
export interface RequestContext {
  /** The school this request acts within. */
  readonly tenantId: string;
  /** Who is acting. Populated in BE-A01. */
  readonly userId?: string;
  /** Correlates log lines for one request. */
  readonly requestId: string;
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

  return context.tenantId;
}
