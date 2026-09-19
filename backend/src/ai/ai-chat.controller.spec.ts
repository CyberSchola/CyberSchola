import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import { ForbiddenException, UnauthenticatedException } from '../common/exceptions/app.exception';
import { Permission, Role } from '../auth/permission.matrix';
import { PermissionInterceptor } from '../auth/permission.interceptor';
import { REQUIRES_PERMISSION_KEY } from '../auth/requires-permission.decorator';
import { runWithRequestContext } from '../tenancy/request-context';
import { AiChatController } from './ai-chat.controller';
import { AiService } from './ai.service';

function makeContext(): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => AiChatController.prototype.chat,
    getClass: () => AiChatController,
    switchToHttp: () => ({ getRequest: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe('AI chat security boundary', () => {
  let reflector: Reflector;
  let interceptor: PermissionInterceptor;
  let chat: jest.Mock;
  let controller: AiChatController;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new PermissionInterceptor(reflector);
    chat = jest.fn().mockResolvedValue('ok');
    controller = new AiChatController({ chat } as unknown as AiService);
  });

  async function invoke(context: {
    tenantId?: string;
    userId?: string;
    role?: string;
  }) {
    return runWithRequestContext(
      {
        origin: 'http',
        tenantId: context.tenantId,
        userId: context.userId,
        roles: context.role === undefined ? undefined : [context.role],
        requestId: 'request-1',
      },
      () =>
        firstValueFrom(
          interceptor.intercept(makeContext(), {
            handle: () => of(controller.chat({ message: 'hello' })),
          } as CallHandler),
        ),
    );
  }

  it('declares Permission.AiChat on the actual controller route', () => {
    expect(
      reflector.getAllAndOverride<Permission>(
        REQUIRES_PERMISSION_KEY,
        [AiChatController.prototype.chat, AiChatController],
      ),
    ).toBe(Permission.AiChat);
  });

  it.each(Object.values(Role))('allows supported role %s to reach AiService', async (role) => {
    await expect(invoke({ tenantId: 'tenant-1', userId: 'user-1', role })).resolves.toEqual({
      message: 'ok',
    });

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        role,
        requestId: 'request-1',
      }),
      'hello',
    );
  });

  it('rejects an unknown role before AiService is reached', async () => {
    await expect(
      invoke({ tenantId: 'tenant-1', userId: 'user-1', role: 'SUPER_ADMIN' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(chat).not.toHaveBeenCalled();
  });

  it('rejects a request with no resolved roles before AiService is reached', async () => {
    await expect(invoke({ tenantId: 'tenant-1', userId: 'user-1' })).rejects.toBeInstanceOf(
      UnauthenticatedException,
    );
    expect(chat).not.toHaveBeenCalled();
  });

  it('rejects a request with no tenant before AiService is reached', async () => {
    await expect(invoke({ userId: 'user-1', role: Role.Teacher })).rejects.toThrow();
    expect(chat).not.toHaveBeenCalled();
  });

  it('rejects a request with no user before AiService is reached', async () => {
    await expect(invoke({ tenantId: 'tenant-1', role: Role.Teacher })).rejects.toThrow();
    expect(chat).not.toHaveBeenCalled();
  });
});
