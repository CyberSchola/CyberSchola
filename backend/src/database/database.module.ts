import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { appDataSourceOptions } from './data-source';

/**
 * Database connection for the running application.
 *
 * Global purely so that modules do not each have to import it. That is
 * dependency availability and nothing more.
 *
 * To be unambiguous about what this does NOT provide today, because a comment
 * that describes intended architecture as though it were current is worse than
 * no comment at all:
 *
 * - There is no tenant scoping here. Nothing in BE-F03 constrains a query to
 *   one school.
 * - Row-level security is not enforced. The policies, the FORCE ROW LEVEL
 *   SECURITY declarations and the restricted application role that make them
 *   bind all arrive with the tenancy work in P1.
 * - No endpoint is tenant-isolated merely because this module is global. Any
 *   query written before P1 lands can read every row in its table.
 *
 * Until then, treat this module as an unrestricted connection, because that is
 * exactly what it is.
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
