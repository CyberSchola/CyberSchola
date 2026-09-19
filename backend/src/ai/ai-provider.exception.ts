import { HttpStatus } from '@nestjs/common';

import { ErrorCode } from '../common/enums/error-code.enum';
import { AppException } from '../common/exceptions/app.exception';

/**
 * Normalizes any provider failure (network error, malformed response, upstream
 * rate limit) into one safe boundary. Callers never see a raw SDK error, stack
 * trace, or upstream URL. Reuses SERVICE_UNAVAILABLE rather than adding a new
 * ErrorCode, since the client-facing meaning ("try again later") is the same.
 */
export class AiProviderException extends AppException {
  constructor() {
    super({
      status: HttpStatus.BAD_GATEWAY,
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'The AI service is temporarily unavailable. Please try again shortly.',
    });
  }
}
