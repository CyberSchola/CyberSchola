import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';

import { SYSTEM_MESSAGES } from '../../constants/system.messages';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';
import { type ApiSuccessResponseDto } from '../dto/api-response.dto';
import { SUCCESS_CODE } from '../enums/error-code.enum';

/**
 * Wraps every successful handler return value in the response envelope.
 *
 * Controllers return their payload and nothing else. Centralising the envelope
 * here means a handler cannot forget it, and cannot invent a variation of it.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccessResponseDto<T>> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccessResponseDto<T>> {
    const message =
      this.reflector.getAllAndOverride<string | undefined>(RESPONSE_MESSAGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? SYSTEM_MESSAGES.SUCCESS;

    const statusCode = context.switchToHttp().getResponse<Response>().statusCode;

    return next.handle().pipe(
      map((data) => ({
        statusCode,
        code: SUCCESS_CODE,
        message,
        // A handler that returns nothing still gets an explicit null rather
        // than an absent key, so the response type has no optional fields.
        data: (data ?? null) as T,
      })),
    );
  }
}
