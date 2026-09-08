import {
  BadRequestException,
  type ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { SYSTEM_MESSAGES } from '../../constants/system.messages';
import { AuditCode, ErrorCode } from '../enums/error-code.enum';
import {
  AiQuotaExceededException,
  ApprovalRequiredException,
  ForbiddenException,
  ResourceAccessDeniedException,
  ResourceNotFoundException,
  ServiceNotReadyException,
  SubscriptionLimitException,
  TenantAccessDeniedException,
  UnauthenticatedException,
  ValidationFailedException,
} from '../exceptions/app.exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface Captured {
  status: number;
  body: Record<string, unknown>;
}

function runFilter(
  exception: unknown,
  request: { method: string; url: string } = { method: 'GET', url: '/api/v1/students/abc' },
): Captured {
  const captured: Captured = { status: 0, body: {} };

  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload;
      return this;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);

  return captured;
}

describe('AllExceptionsFilter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('the tenant boundary', () => {
    // This is the reason decision 6A exists. If these two ever diverge, an
    // attacker can tell a real id in another school from an id that was never
    // issued, and enumerate across tenants one request at a time.
    it('renders a cross-tenant denial byte for byte identically to a genuine miss', () => {
      const crossTenant = runFilter(new TenantAccessDeniedException());
      const genuineMiss = runFilter(new ResourceNotFoundException());

      expect(crossTenant.status).toBe(genuineMiss.status);
      expect(crossTenant.body).toEqual(genuineMiss.body);
      expect(JSON.stringify(crossTenant.body)).toBe(JSON.stringify(genuineMiss.body));
    });

    it('renders an unauthorised-resource denial identically too', () => {
      const denied = runFilter(new ResourceAccessDeniedException());
      const genuineMiss = runFilter(new ResourceNotFoundException());

      expect(denied.body).toEqual(genuineMiss.body);
    });

    it('never puts an audit code in a response body', () => {
      for (const exception of [
        new TenantAccessDeniedException(),
        new ResourceAccessDeniedException(),
      ]) {
        const serialised = JSON.stringify(runFilter(exception).body);

        for (const auditCode of Object.values(AuditCode)) {
          expect(serialised).not.toContain(auditCode);
        }
      }
    });

    it('records the audit code in the log, so the attempt is still visible to us', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      runFilter(new TenantAccessDeniedException(), {
        method: 'GET',
        url: '/api/v1/students/other-school-id',
      });

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(AuditCode.TENANT_ACCESS_DENIED));
    });

    it('logs a plain miss under its public code, since there is nothing to hide', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      runFilter(new ResourceNotFoundException());

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(ErrorCode.NOT_FOUND));
    });
  });

  describe('application exceptions', () => {
    it.each([
      [new UnauthenticatedException(), HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED],
      [new ForbiddenException(), HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN],
      [new ResourceNotFoundException(), HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND],
      [new SubscriptionLimitException(), HttpStatus.PAYMENT_REQUIRED, ErrorCode.SUBSCRIPTION_LIMIT],
      [new AiQuotaExceededException(), HttpStatus.TOO_MANY_REQUESTS, ErrorCode.AI_QUOTA_EXCEEDED],
      [new ApprovalRequiredException(), HttpStatus.FORBIDDEN, ErrorCode.APPROVAL_REQUIRED],
    ])('maps %p to its status and code', (exception, status, code) => {
      const { status: actualStatus, body } = runFilter(exception);

      expect(actualStatus).toBe(status);
      expect(body.statusCode).toBe(status);
      expect(body.code).toBe(code);
      expect(body.message).toEqual(expect.any(String));
    });

    it('carries field-level detail on a validation failure', () => {
      const { body } = runFilter(
        new ValidationFailedException(['email must be a valid email address']),
      );

      expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(body.details).toEqual(['email must be a valid email address']);
    });

    it('omits details entirely rather than sending an empty array', () => {
      expect(runFilter(new ResourceNotFoundException()).body).not.toHaveProperty('details');
      expect(runFilter(new ValidationFailedException([])).body).not.toHaveProperty('details');
    });
  });

  describe('framework exceptions', () => {
    it('maps an unmatched route to the same envelope as any other miss', () => {
      const { status, body } = runFilter(new NotFoundException());

      expect(status).toBe(HttpStatus.NOT_FOUND);
      expect(body).toEqual({
        statusCode: HttpStatus.NOT_FOUND,
        code: ErrorCode.NOT_FOUND,
        message: SYSTEM_MESSAGES.RESOURCE.NOT_FOUND,
      });
    });

    it('lifts the ValidationPipe messages into details', () => {
      const { body } = runFilter(
        new BadRequestException({
          message: ['name should not be empty', 'age must be an integer'],
          error: 'Bad Request',
          statusCode: 400,
        }),
      );

      expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(body.details).toEqual(['name should not be empty', 'age must be an integer']);
    });

    it("drops the framework's own error field, which tells the caller nothing", () => {
      const { body } = runFilter(
        new BadRequestException({ message: ['bad'], error: 'Bad Request', statusCode: 400 }),
      );

      expect(body).not.toHaveProperty('error');
      expect(Object.keys(body).sort()).toEqual(['code', 'details', 'message', 'statusCode']);
    });

    it('does not treat a plain string message as details', () => {
      const { body } = runFilter(new BadRequestException('something was wrong'));

      expect(body).not.toHaveProperty('details');
      expect(body.message).toBe(SYSTEM_MESSAGES.VALIDATION.FAILED);
    });
  });

  describe('unknown failures', () => {
    it('never reflects an internal error message back to the caller', () => {
      const { status, body } = runFilter(
        new Error('connection to db.internal:5432 failed for user cyberschola_app'),
      );

      expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body).toEqual({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.INTERNAL_ERROR,
        message: SYSTEM_MESSAGES.GENERIC.INTERNAL_ERROR,
      });
      expect(JSON.stringify(body)).not.toContain('db.internal');
      expect(JSON.stringify(body)).not.toContain('cyberschola_app');
    });

    it('handles a thrown non-Error without crashing the filter', () => {
      for (const thrown of ['a string', 42, null, undefined, { nested: true }]) {
        const { status, body } = runFilter(thrown);

        expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(body.code).toBe(ErrorCode.INTERNAL_ERROR);
      }
    });

    it('logs a stack trace for a server error, and only warns for a client error', () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      runFilter(new Error('boom'));
      expect(error).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();

      runFilter(new ResourceNotFoundException());
      expect(warn).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
    });

    it('treats an unmapped 4xx as a validation error rather than a server error', () => {
      const { body } = runFilter(new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT));

      expect(body.statusCode).toBe(HttpStatus.I_AM_A_TEAPOT);
      expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('treats an unmapped 5xx as an internal error', () => {
      // 502 rather than 503: 503 now has its own entry, so it would no longer
      // exercise the fallback this test exists to cover.
      const { body } = runFilter(new HttpException('upstream down', HttpStatus.BAD_GATEWAY));

      expect(body.statusCode).toBe(HttpStatus.BAD_GATEWAY);
      expect(body.code).toBe(ErrorCode.INTERNAL_ERROR);
    });
  });

  // Requested on review: an explicit sweep of the three exception families, so
  // the boundary the web application codes against is pinned rather than
  // inferred. Whatever is thrown, the body has the same four possible keys and
  // never carries anything the caller was not meant to see.
  describe('every exception family produces a well-formed envelope', () => {
    const ALLOWED_KEYS = ['code', 'details', 'message', 'statusCode'];

    const cases: Array<[string, unknown]> = [
      ['AppException', new ResourceNotFoundException()],
      ['AppException with details', new ValidationFailedException(['a must be a string'])],
      ['AppException with an audit code', new TenantAccessDeniedException()],
      ['HttpException from the framework', new NotFoundException()],
      ['HttpException with a payload object', new BadRequestException({ message: ['x'] })],
      ['HttpException with a string payload', new BadRequestException('plain')],
      ['unknown Error', new Error('internal detail')],
      ['thrown string', 'a string'],
      ['thrown number', 42],
      ['thrown null', null],
      ['thrown undefined', undefined],
      ['thrown plain object', { nested: true }],
      ['thrown array', [1, 2, 3]],
      ['ServiceNotReadyException', new ServiceNotReadyException()],
    ];

    it.each(cases)('%s: status is a valid HTTP code', (_label, thrown) => {
      const { status, body } = runFilter(thrown);

      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
      expect(body.statusCode).toBe(status);
    });

    it.each(cases)('%s: code is one of the documented identities', (_label, thrown) => {
      expect(Object.values(ErrorCode)).toContain(runFilter(thrown).body.code);
    });

    it.each(cases)('%s: message is a non-empty string from system messages', (_label, thrown) => {
      const { message } = runFilter(thrown).body;

      expect(typeof message).toBe('string');
      expect((message as string).length).toBeGreaterThan(0);
    });

    it.each(cases)('%s: body carries no key beyond the documented four', (_label, thrown) => {
      for (const key of Object.keys(runFilter(thrown).body)) {
        expect(ALLOWED_KEYS).toContain(key);
      }
    });

    it.each(cases)('%s: body is JSON-serialisable, which express requires', (_label, thrown) => {
      expect(() => JSON.stringify(runFilter(thrown).body)).not.toThrow();
    });

    it.each(cases)('%s: no audit code reaches the caller', (_label, thrown) => {
      const serialised = JSON.stringify(runFilter(thrown).body);

      for (const auditCode of Object.values(AuditCode)) {
        expect(serialised).not.toContain(auditCode);
      }
    });

    it.each(cases)('%s: no stack trace reaches the caller', (_label, thrown) => {
      const serialised = JSON.stringify(runFilter(thrown).body);

      expect(serialised).not.toContain('at ');
      expect(serialised).not.toContain('.ts:');
      expect(serialised).not.toContain('node_modules');
    });
  });

  it('returns only the four documented keys, so the envelope cannot drift', () => {
    expect(Object.keys(runFilter(new ResourceNotFoundException()).body).sort()).toEqual([
      'code',
      'message',
      'statusCode',
    ]);
  });
});
