import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Tenant } from './tenant.entity';
import { TenantSetting } from './tenant-settings.entity';
import { TenantTransactionService } from './tenant-transaction.service';

/**
 * Tenancy primitives.
 *
 * Global because the tenant context is needed wherever school data is touched,
 * which will eventually be everywhere. What this module does NOT yet provide:
 * request-scoped tenant resolution and the tenant-scoped action base class.
 * Those arrive in BE-T02. Until then a caller opens a context explicitly.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Tenant, TenantSetting])],
  providers: [TenantTransactionService],
  exports: [TenantTransactionService, TypeOrmModule],
})
export class TenancyModule {}
