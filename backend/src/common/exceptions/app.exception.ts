import { HttpException, HttpStatus } from '@nestjs/common';

import { SYSTEM_MESSAGES } from '../../constants/system.messages';
import { AuditCode, ErrorCode } from '../enums/error-code.enum';

/**
 * Base for every exception the application raises deliberately.
 *
 * Carries two identities. `code` is what the client sees and branches on.
 * `auditCode` is what the log records, and is optional because most failures
 * have nothing extra to say. They differ only where telling the truth to the
 * caller would leak something, which today is exactly the tenant boundary.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly auditCode?: AuditCode;
  readonly details?: readonly string[];

  constructor(params: {
    status: HttpStatus;
    code: ErrorCode;
    message: string;
    auditCode?: AuditCode;
    details?: readonly string[];
  }) {
    super(params.message, params.status);
    this.code = params.code;
    this.auditCode = params.auditCode;
    this.details = params.details;
  }
}

export class UnauthenticatedException extends AppException {
  constructor(message: string = SYSTEM_MESSAGES.AUTH.UNAUTHENTICATED) {
    super({ status: HttpStatus.UNAUTHORIZED, code: ErrorCode.UNAUTHENTICATED, message });
  }
}

export class ForbiddenException extends AppException {
  constructor(message: string = SYSTEM_MESSAGES.AUTH.FORBIDDEN) {
    super({ status: HttpStatus.FORBIDDEN, code: ErrorCode.FORBIDDEN, message });
  }
}

export class ResourceNotFoundException extends AppException {
  constructor(message: string = SYSTEM_MESSAGES.RESOURCE.NOT_FOUND) {
    super({ status: HttpStatus.NOT_FOUND, code: ErrorCode.NOT_FOUND, message });
  }
}

/**
 * Raised when a caller asks for a resource that exists but belongs to another
 * school.
 *
 * Externally this is a plain 404, byte for byte identical to asking for an id
 * that was never issued. A 403 saying "tenant access denied" would confirm the
 * id exists somewhere in the system, which is all an attacker needs to
 * enumerate across tenants. The exception filter records the audit code, so
 * the attempt is still visible to us.
 */
export class TenantAccessDeniedException extends AppException {
  constructor() {
    super({
      status: HttpStatus.NOT_FOUND,
      code: ErrorCode.NOT_FOUND,
      message: SYSTEM_MESSAGES.RESOURCE.NOT_FOUND,
      auditCode: AuditCode.TENANT_ACCESS_DENIED,
    });
  }
}

/**
 * Raised when the caller is in the right school but not entitled to this
 * specific resource, for example a teacher asking about a student they neither
 * supervise nor teach.
 *
 * Also a 404. Within one school, confirming that a student id exists is itself
 * information a teacher is not entitled to.
 */
export class ResourceAccessDeniedException extends AppException {
  constructor() {
    super({
      status: HttpStatus.NOT_FOUND,
      code: ErrorCode.NOT_FOUND,
      message: SYSTEM_MESSAGES.RESOURCE.NOT_FOUND,
      auditCode: AuditCode.RESOURCE_ACCESS_DENIED,
    });
  }
}

export class ValidationFailedException extends AppException {
  constructor(details: readonly string[], message: string = SYSTEM_MESSAGES.VALIDATION.FAILED) {
    super({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: ErrorCode.VALIDATION_ERROR,
      message,
      details,
    });
  }
}

export class SubscriptionLimitException extends AppException {
  constructor(message: string = SYSTEM_MESSAGES.SUBSCRIPTION.LIMIT_REACHED) {
    super({ status: HttpStatus.PAYMENT_REQUIRED, code: ErrorCode.SUBSCRIPTION_LIMIT, message });
  }
}

export class AiQuotaExceededException extends AppException {
  constructor(message: string = SYSTEM_MESSAGES.AI.QUOTA_EXCEEDED) {
    super({ status: HttpStatus.TOO_MANY_REQUESTS, code: ErrorCode.AI_QUOTA_EXCEEDED, message });
  }
}

export class ApprovalRequiredException extends AppException {
  constructor(message: string = SYSTEM_MESSAGES.APPROVAL.REQUIRED) {
    super({ status: HttpStatus.FORBIDDEN, code: ErrorCode.APPROVAL_REQUIRED, message });
  }
}

/**
 * Raised when the process cannot serve traffic because a dependency it needs
 * is unreachable.
 *
 * Carries no detail about which dependency or why. The readiness endpoint is
 * unauthenticated, and a failure reason names a host, a port and a role. The
 * detail goes to the log.
 */
export class ServiceNotReadyException extends AppException {
  constructor(message: string = SYSTEM_MESSAGES.HEALTH.NOT_READY) {
    super({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message,
    });
  }
}

export class ResourceConflictException extends AppException {
  constructor(message: string = SYSTEM_MESSAGES.RESOURCE.CONFLICT) {
    super({ status: HttpStatus.CONFLICT, code: ErrorCode.CONFLICT, message });
  }
}
