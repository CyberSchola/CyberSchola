import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TenantContextInterceptor } from './tenant-context.interceptor';
import { MembershipTenantResolver, TENANT_RESOLVER } from './tenant-resolver';
import { Tenant } from './tenant.entity';
import { TenantSetting } from './tenant-settings.entity';
import { JobContextService } from './job-context.service';
import { TenantTransactionService } from './tenant-transaction.service';

/**
 * Tenancy primitives.
 *
 * Global because the tenant context is needed wherever school data is touched,
 * which will eventually be everywhere.
 *
 * The resolver bound here is `MembershipTenantResolver`, which reads the
 * caller's memberships under row-level security and never takes a school from
 * a token body. It replaced `UnresolvedTenantResolver`, which resolved nothing
 * and kept every tenant-scoped route closed until authentication existed.
 *
 * The header the resolver reads selects among schools the database confirmed
 * the caller belongs to. It cannot name one outside that set, which is what
 * separates it from the `X-Tenant-Id` assertion BE-T02 deliberately refused.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Tenant, TenantSetting])],
  providers: [
    TenantTransactionService,
    JobContextService,
    TenantContextInterceptor,
    { provide: TENANT_RESOLVER, useClass: MembershipTenantResolver },
  ],
  exports: [
    TenantTransactionService,
    JobContextService,
    TenantContextInterceptor,
    TENANT_RESOLVER,
    TypeOrmModule,
  ],
})
export class TenancyModule {}
