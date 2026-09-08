import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ErrorCode, SUCCESS_CODE } from '../enums/error-code.enum';

/**
 * Shape of every response the API returns, success or failure.
 *
 * `code` is present on both so a client has one field to switch on and one
 * type to parse, rather than having to test which fields exist.
 */
export class ApiSuccessResponseDto<T = unknown> {
  @ApiProperty({ example: 200 })
  statusCode!: number;

  @ApiProperty({ example: SUCCESS_CODE, enum: [SUCCESS_CODE] })
  code!: typeof SUCCESS_CODE;

  @ApiProperty({ example: 'Request successful.' })
  message!: string;

  @ApiProperty({ description: 'The response payload. Null for actions that return nothing.' })
  data!: T;
}

export class ApiErrorResponseDto {
  @ApiProperty({ example: 404 })
  statusCode!: number;

  @ApiProperty({
    enum: ErrorCode,
    example: ErrorCode.NOT_FOUND,
    description:
      'Stable machine-readable identity for this failure. Branch on this, never on the message.',
  })
  code!: ErrorCode;

  @ApiProperty({ example: 'The requested resource was not found.' })
  message!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Field-level problems. Present only on VALIDATION_ERROR.',
    example: ['email must be a valid email address'],
  })
  details?: string[];
}
