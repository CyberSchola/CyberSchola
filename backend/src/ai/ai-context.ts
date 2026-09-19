import { getRequestContext, requireTenantId, requireUserId } from '../tenancy/request-context';
import type { AiRequestContext } from './ai-provider.interface';

/**
 * Builds the trusted AiRequestContext from the backend's already-verified
 * RequestContext. requireTenantId/requireUserId throw if either is missing —
 * by the time this runs, AuthGuard/TenantContextInterceptor/PermissionInterceptor
 * have already run, so a throw here means one of them was bypassed.
 */
export function resolveAiRequestContext(): AiRequestContext {
  const tenantId = requireTenantId();
  const userId = requireUserId();
  const context = getRequestContext();

  return {
    tenantId,
    userId,
    role: context?.role ?? '',
    requestId: context?.requestId ?? '',
  };
}