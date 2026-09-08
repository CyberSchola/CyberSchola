import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { SYSTEM_MESSAGES } from '../../constants/system.messages';
import { type ApiErrorResponseDto } from '../dto/api-response.dto';
import { ErrorCode } from '../enums/error-code.enum';
import { AppException } from '../exceptions/app.exception';

interface PublicFailure {
  code: ErrorCode;
  message: string;
}

/**
 * How a status raised by the framework itself is presented to the caller.
 *
 * One table rather than a switch per field: the code and the message for a
 * given status must always move together, and two parallel switches would
 * eventually disagree.
 */
const FAILURE_BY_STATUS: ReadonlyMap<number, PublicFailure> = new Map([
  [
    HttpStatus.UNAUTHORIZED,
    { code: ErrorCode.UNAUTHENTICATED, message: SYSTEM_MESSAGES.AUTH.UNAUTHENTICATED },
  ],
  [HttpStatus.FORBIDDEN, { code: ErrorCode.FORBIDDEN, message: SYSTEM_MESSAGES.AUTH.FORBIDDEN }],
  [
    HttpStatus.NOT_FOUND,
    { code: ErrorCode.NOT_FOUND, message: SYSTEM_MESSAGES.RESOURCE.NOT_FOUND },
  ],
  [HttpStatus.CONFLICT, { code: ErrorCode.CONFLICT, message: SYSTEM_MESSAGES.RESOURCE.CONFLICT }],
  [
    HttpStatus.BAD_REQUEST,
    { code: ErrorCode.VALIDATION_ERROR, message: SYSTEM_MESSAGES.VALIDATION.FAILED },
  ],
  [
    HttpStatus.UNPROCESSABLE_ENTITY,
    { code: ErrorCode.VALIDATION_ERROR, message: SYSTEM_MESSAGES.VALIDATION.FAILED },
  ],
  // Without this entry a 503 falls into the server fallback and is reported as
  // INTERNAL_ERROR, which tells a client the service is broken when in fact it
  // is temporarily unavailable. The two call for different client behaviour:
  // one is worth retrying, the other is not.
  [
    HttpStatus.SERVICE_UNAVAILABLE,
    { code: ErrorCode.SERVICE_UNAVAILABLE, message: SYSTEM_MESSAGES.GENERIC.UNAVAILABLE },
  ],
]);

const CLIENT_FALLBACK: PublicFailure = {
  code: ErrorCode.VALIDATION_ERROR,
  message: SYSTEM_MESSAGES.VALIDATION.FAILED,
};

const SERVER_FALLBACK: PublicFailure = {
  code: ErrorCode.INTERNAL_ERROR,
  message: SYSTEM_MESSAGES.GENERIC.INTERNAL_ERROR,
};

/**
 * A plain number rather than HttpStatus.INTERNAL_SERVER_ERROR, because the
 * value being compared is an arbitrary status from a third-party exception and
 * is not a member of that enum. Comparing the two is exactly what
 * no-unsafe-enum-comparison is there to catch.
 */
const SERVER_ERROR_THRESHOLD = 500;

/**
 * Turns every thrown value into the error envelope.
 *
 * Three rules it exists to guarantee:
 *
 * 1. A response body never contains a stack trace, an ORM message, or a
 *    driver error. Those go to the log, which only we read.
 * 2. Anything unrecognised becomes a 500 with a generic message. Reflecting an
 *    unknown error's text back to the caller is how internal detail escapes.
 * 3. An AppException carrying an audit code is logged under that code while
 *    the caller sees only the public one, which is what keeps a cross-tenant
 *    request indistinguishable from a genuine miss.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.toErrorBody(exception);
    this.log(exception, body, request);

    response.status(body.statusCode).json(body);
  }

  private toErrorBody(exception: unknown): ApiErrorResponseDto {
    if (exception instanceof AppException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        ...(exception.details?.length ? { details: [...exception.details] } : {}),
      };
    }

    // Exceptions Nest raises itself: 404 from the router, 400 from a pipe,
    // 401 from a guard. Their bodies are framework-shaped, so only the status
    // and any validation detail are carried across.
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();

      return {
        statusCode,
        ...this.publicFailureFor(statusCode),
        ...this.detailsFromHttpException(exception),
      };
    }

    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, ...SERVER_FALLBACK };
  }

  private publicFailureFor(statusCode: number): PublicFailure {
    return (
      FAILURE_BY_STATUS.get(statusCode) ??
      (statusCode < SERVER_ERROR_THRESHOLD ? CLIENT_FALLBACK : SERVER_FALLBACK)
    );
  }

  /**
   * Pulls field-level messages out of the ValidationPipe's response.
   *
   * Only the string array is taken. The pipe also returns an `error` field
   * naming the framework's own status text, which tells the caller nothing and
   * would vary with the framework version.
   */
  private detailsFromHttpException(exception: HttpException): { details?: string[] } {
    const payload: unknown = exception.getResponse();

    if (typeof payload !== 'object' || payload === null || !('message' in payload)) {
      return {};
    }

    const message: unknown = payload.message;

    return Array.isArray(message) && message.every((item) => typeof item === 'string')
      ? { details: message }
      : {};
  }

  private log(exception: unknown, body: ApiErrorResponseDto, request: Request): void {
    // The audit code is the reason this branch exists: the caller was told
    // "not found", and the log is the only place the real reason survives.
    const auditCode = exception instanceof AppException ? exception.auditCode : undefined;
    const label: string = auditCode ?? body.code;
    const where = `${request.method} ${request.url}`;

    if (body.statusCode >= SERVER_ERROR_THRESHOLD) {
      this.logger.error(
        `${label} ${where}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      return;
    }

    this.logger.warn(`${label} ${where}`);
  }
}
