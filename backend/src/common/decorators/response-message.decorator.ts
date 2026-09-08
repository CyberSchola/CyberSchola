import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'response_message';

/**
 * Sets the human-readable message on a successful response.
 *
 * Without it the interceptor falls back to a generic success string, which is
 * correct but says nothing useful. Prefer a message from
 * `SYSTEM_MESSAGES` over an inline literal, so wording stays reviewable in one
 * place.
 */
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE_KEY, message);
