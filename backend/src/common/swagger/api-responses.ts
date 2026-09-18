import { applyDecorators, HttpStatus, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

import { SYSTEM_MESSAGES } from '../../constants/system.messages';
import { ResponseMessage } from '../decorators/response-message.decorator';
import { ErrorCode } from '../enums/error-code.enum';

/** The envelope every successful response shares. */
function envelope(data: Record<string, unknown>, status: HttpStatus, message: string) {
  return {
    type: 'object',
    properties: {
      statusCode: { type: 'number', example: status },
      code: { type: 'string', example: 'OK' },
      message: { type: 'string', example: message },
      data,
    },
  };
}

/**
 * Documents a paginated list: the envelope around `items`, `total`, `limit` and
 * `offset`. Also sets the success message, so the message a client receives and
 * the one the documentation shows come from the same argument and cannot drift.
 *
 * Written once because the academic spine has ten list endpoints, and a wrapper
 * class per resource would be ten near-identical classes whose only job is to
 * describe the same shape to Swagger.
 */
export function ApiPageResponse(model: Type<unknown>, message: string) {
  return applyDecorators(
    ResponseMessage(message),
    ApiExtraModels(model),
    ApiResponse({
      status: HttpStatus.OK,
      description: 'The page of results this caller may see.',
      schema: envelope(
        {
          type: 'object',
          properties: {
            items: { type: 'array', items: { $ref: getSchemaPath(model) } },
            total: {
              type: 'number',
              description: 'Rows this caller may see, under the same scope as `items`.',
            },
            limit: { type: 'number', example: 25 },
            offset: { type: 'number', example: 0 },
          },
        },
        HttpStatus.OK,
        message,
      ),
    }),
    ApiErrorResponse(
      HttpStatus.BAD_REQUEST,
      '`limit` outside 1 to 100, `offset` below 0, or either not a whole number.',
    ),
  );
}

/** Documents a single record in the envelope, and sets its success message. */
export function ApiItemResponse(
  model: Type<unknown>,
  message: string,
  status: HttpStatus = HttpStatus.OK,
) {
  return applyDecorators(
    ResponseMessage(message),
    ApiExtraModels(model),
    ApiResponse({
      status,
      description: message,
      schema: envelope({ $ref: getSchemaPath(model) }, status, message),
    }),
  );
}

/**
 * Documents a success that returns no record, such as a removal, and sets its
 * message. The envelope still arrives, with `data: null`, so every client parses
 * every response the same way.
 */
export function ApiEmptyResponse(message: string) {
  return applyDecorators(
    ResponseMessage(message),
    ApiResponse({
      status: HttpStatus.OK,
      description: message,
      schema: envelope({ type: 'object', nullable: true, example: null }, HttpStatus.OK, message),
    }),
  );
}

type DocumentedFailure =
  | HttpStatus.BAD_REQUEST
  | HttpStatus.UNAUTHORIZED
  | HttpStatus.FORBIDDEN
  | HttpStatus.NOT_FOUND
  | HttpStatus.CONFLICT
  | HttpStatus.UNPROCESSABLE_ENTITY;

/** What the exception filter actually returns for each status, so the example is never invented. */
const FAILURE_EXAMPLES: Record<DocumentedFailure, { code: ErrorCode; message: string }> = {
  [HttpStatus.BAD_REQUEST]: {
    code: ErrorCode.VALIDATION_ERROR,
    message: SYSTEM_MESSAGES.VALIDATION.FAILED,
  },
  [HttpStatus.UNAUTHORIZED]: {
    code: ErrorCode.UNAUTHENTICATED,
    message: SYSTEM_MESSAGES.AUTH.UNAUTHENTICATED,
  },
  [HttpStatus.FORBIDDEN]: { code: ErrorCode.FORBIDDEN, message: SYSTEM_MESSAGES.AUTH.FORBIDDEN },
  [HttpStatus.NOT_FOUND]: {
    code: ErrorCode.NOT_FOUND,
    message: SYSTEM_MESSAGES.RESOURCE.NOT_FOUND,
  },
  [HttpStatus.CONFLICT]: { code: ErrorCode.CONFLICT, message: SYSTEM_MESSAGES.RESOURCE.CONFLICT },
  [HttpStatus.UNPROCESSABLE_ENTITY]: {
    code: ErrorCode.VALIDATION_ERROR,
    message: SYSTEM_MESSAGES.VALIDATION.FAILED,
  },
};

/**
 * Documents one failure a route can return, in the error envelope.
 *
 * Without these, Swagger labels every refusal "Undocumented", and a frontend
 * developer has to discover by trial which of 404, 409 and 422 a form can
 * produce. The description says when it happens; the example is the body the
 * filter really sends.
 */
export function ApiErrorResponse(
  status: DocumentedFailure,
  description: string,
  /** The message the route really sends, when it is more specific than the default. */
  specificMessage?: string,
) {
  const { code, message: defaultMessage } = FAILURE_EXAMPLES[status];
  const message = specificMessage ?? defaultMessage;
  return ApiResponse({
    status,
    description,
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: status },
        code: { type: 'string', enum: Object.values(ErrorCode), example: code },
        message: { type: 'string', example: message },
      },
    },
  });
}
