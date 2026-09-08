/**
 * Error identities the API returns to clients.
 *
 * These are a contract. The frontend branches on `code` to choose a UI state,
 * so a code may be added but never renamed or repurposed. The human-readable
 * `message` beside it is free to change; the code is not.
 */
export enum ErrorCode {
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  SUBSCRIPTION_LIMIT = 'SUBSCRIPTION_LIMIT',
  AI_QUOTA_EXCEEDED = 'AI_QUOTA_EXCEEDED',
  APPROVAL_REQUIRED = 'APPROVAL_REQUIRED',
  CONFLICT = 'CONFLICT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/** The single success code, so every response has the same shape. */
export const SUCCESS_CODE = 'OK' as const;

/**
 * Identities that are recorded but never returned.
 *
 * TENANT_ACCESS_DENIED is deliberately absent from ErrorCode. Telling a caller
 * that a resource belongs to another school confirms the resource exists, and
 * that is enough to enumerate ids across tenants. Externally a resource outside
 * the caller's tenant is indistinguishable from one that does not exist, so it
 * returns NOT_FOUND. This code exists only for the log and the audit trail,
 * where the distinction matters and only we can read it.
 *
 * Keeping the two enums separate makes the leak unrepresentable: there is no
 * way to place this value in a response body without deliberately importing
 * the wrong enum.
 */
export enum AuditCode {
  TENANT_ACCESS_DENIED = 'TENANT_ACCESS_DENIED',
  RESOURCE_ACCESS_DENIED = 'RESOURCE_ACCESS_DENIED',
}
