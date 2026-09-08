import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { appDataSourceOptions } from './data-source';

/**
 * Database connection for the running application.
 *
 * Global so that modules do not each have to import it. That is a convenience
 * for wiring only: it does not widen data access, because every query still
 * goes through a tenant-scoped action, and the database role the API connects
 * as has row-level security forced on it.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRoot({
      ...appDataSourceOptions,
      // Entities are discovered from the compiled output in production and
      // from source in development, so `pnpm start:dev` picks up a new entity
      // without a build step.
      autoLoadEntities: true,
      retryAttempts: 5,
      retryDelay: 2_000,
    }),
  ],
})
export class DatabaseModule {}
