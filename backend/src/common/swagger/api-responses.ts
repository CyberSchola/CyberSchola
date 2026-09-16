import { applyDecorators, HttpStatus, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

/** The envelope every successful response shares. */
function envelope(data: Record<string, unknown>, status: HttpStatus) {
  return {
    type: 'object',
    properties: {
      statusCode: { type: 'number', example: status },
      code: { type: 'string', example: 'OK' },
      message: { type: 'string' },
      data,
    },
  };
}

/**
 * Documents a paginated list: the envelope around `items`, `total`, `limit` and
 * `offset`.
 *
 * Written once because the academic spine has ten list endpoints, and a wrapper
 * class per resource would be ten near-identical classes whose only job is to
 * describe the same shape to Swagger.
 */
export function ApiPageResponse(model: Type<unknown>) {
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status: HttpStatus.OK,
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
      ),
    }),
  );
}

/** Documents a single record in the envelope, for a create or an update. */
export function ApiItemResponse(model: Type<unknown>, status: HttpStatus = HttpStatus.OK) {
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({ status, schema: envelope({ $ref: getSchemaPath(model) }, status) }),
  );
}
