/**
 * Every user-facing string the API returns.
 *
 * Centralised for three reasons: the wording stays consistent across modules,
 * a message can be reviewed without reading the code that throws it, and
 * translation later touches one file rather than two hundred call sites.
 *
 * Messages explain what happened and what to do about it. They never name a
 * table, a column, an internal identifier, or another tenant's data.
 */
export const SYSTEM_MESSAGES = {
  SUCCESS: 'Request successful.',

  HEALTH: {
    LIVE: 'Service is running.',
  },

  AUTH: {
    UNAUTHENTICATED: 'You need to sign in to continue.',
    FORBIDDEN: 'You do not have permission to perform this action.',
  },

  /**
   * One message for every not-found case, whether the resource is absent or
   * belongs to another school. The two must be indistinguishable from outside;
   * see AuditCode in error-code.enum.ts.
   */
  RESOURCE: {
    NOT_FOUND: 'The requested resource was not found.',
    CONFLICT: 'This action conflicts with the current state of the resource.',
  },

  VALIDATION: {
    FAILED: 'Some of the information provided is not valid.',
  },

  SUBSCRIPTION: {
    LIMIT_REACHED: "This feature is not included in your school's current plan.",
  },

  AI: {
    QUOTA_EXCEEDED: 'The AI usage limit for your school has been reached for now.',
  },

  APPROVAL: {
    REQUIRED: 'This change needs administrator approval before it can be applied.',
  },

  GENERIC: {
    INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
  },
} as const;
