import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TenantContextInterceptor } from './tenant-context.interceptor';
import { TENANT_RESOLVER, UnresolvedTenantResolver } from './tenant-resolver';
import { Tenant } from './tenant.entity';
import { TenantSetting } from './tenant-settings.entity';
import { TenantTransactionService } from './tenant-transaction.service';

/**
 * Tenancy primitives.
 *
 * Global because the tenant context is needed wherever school data is touched,
 * which will eventually be everywhere.
 *
 * The resolver bound here is `UnresolvedTenantResolver`, which resolves
 * nothing, so every tenant-scoped route is closed until authentication lands
 * in BE-A01. That is the safe default rather than a placeholder: the
 * alternative, trusting a header "for now", is an authentication bypass that
 * every isolation test would still pass against.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Tenant, TenantSetting])],
  providers: [
    TenantTransactionService,
    TenantContextInterceptor,
    { provide: TENANT_RESOLVER, useClass: UnresolvedTenantResolver },
  ],
  exports: [TenantTransactionService, TenantContextInterceptor, TENANT_RESOLVER, TypeOrmModule],
})
export class TenancyModule {}
