import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { TenantTransactionService } from './tenant-transaction.service';

type RoleRow = { role: string; bypassrls: boolean; superuser: boolean };

function serviceWithRoles(rows: RoleRow[]): TenantTransactionService {
  const dataSource = { query: jest.fn().mockResolvedValue(rows) } as unknown as DataSource;
  const service = new TenantTransactionService(dataSource);

  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  return service;
}

const RESTRICTED: RoleRow = { role: 'cyberschola_app', bypassrls: false, superuser: false };
const BYPASSING: RoleRow = { role: 'postgres', bypassrls: true, superuser: false };
const SUPERUSER: RoleRow = { role: 'postgres', bypassrls: false, superuser: true };

describe('TenantTransactionService', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('assertRoleCannotBypassRls', () => {
    it('accepts the restricted application role', async () => {
      await expect(
        serviceWithRoles([RESTRICTED]).assertRoleCannotBypassRls('production'),
      ).resolves.toBeUndefined();
    });

    it.each([
      ['a BYPASSRLS role', BYPASSING],
      ['a superuser', SUPERUSER],
    ])('refuses to boot in production as %s', async (_label, row) => {
      // Either attribute makes every tenant policy inert while the whole test
      // suite stays green, which is the failure decision 18A exists for.
      await expect(serviceWithRoles([row]).assertRoleCannotBypassRls('production')).rejects.toThrow(
        /row-level security/i,
      );
    });

    it.each(['development', 'test'])('warns but continues in %s as a superuser', async (env) => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(
        serviceWithRoles([SUPERUSER]).assertRoleCannotBypassRls(env),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(env));
    });

    describe('when the connected role cannot be determined', () => {
      it('refuses to boot in production rather than logging and carrying on', async () => {
        // The change this review asked for. Previously this logged a warning
        // and returned, so the application served traffic having never
        // established that tenant isolation applied to it at all.
        await expect(serviceWithRoles([]).assertRoleCannotBypassRls('production')).rejects.toThrow(
          /could not determine the connected database role/i,
        );
      });

      it('refuses in staging too, since only local environments are exempt', async () => {
        await expect(serviceWithRoles([]).assertRoleCannotBypassRls('staging')).rejects.toThrow(
          /could not determine/i,
        );
      });

      it('explains the consequence rather than only the symptom', async () => {
        // Someone reading this at 2am needs to know why an unreadable role
        // stops a deploy, or they will work around it.
        await expect(serviceWithRoles([]).assertRoleCannotBypassRls('production')).rejects.toThrow(
          /inert/i,
        );
      });

      it.each(['development', 'test'])('warns but continues in %s', async (env) => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

        await expect(serviceWithRoles([]).assertRoleCannotBypassRls(env)).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();
      });
    });
  });

  describe('onApplicationBootstrap', () => {
    it('runs the assertion, so the guarantee is not merely available', async () => {
      // Before this hook existed nothing called assertRoleCannotBypassRls
      // anywhere in the application, so the check described in its own comment
      // never actually ran. This test is what keeps it wired.
      const service = serviceWithRoles([SUPERUSER]);
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        await expect(service.onApplicationBootstrap()).rejects.toThrow(/row-level security/i);
      } finally {
        process.env.NODE_ENV = previous;
      }
    });

    it('lets a correctly configured application start', async () => {
      const service = serviceWithRoles([RESTRICTED]);
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
      } finally {
        process.env.NODE_ENV = previous;
      }
    });
  });
});
