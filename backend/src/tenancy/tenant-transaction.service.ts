import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';

/**
 * Runs work inside a transaction whose tenant context the database enforces.
 *
 * This is the runtime half of decision 1A. The policies from the migration
 * compare `tenant_id` against `current_tenant_id()`, which reads
 * `app.current_tenant`. Nothing sets that by itself, so without this service
 * every policy evaluates against NULL and every tenant-owned query returns
 * nothing. That is the correct direction to fail, but it is not useful.
 *
 * Two details that are easy to get wrong and expensive to get wrong:
 *
 * **SET LOCAL, never SET.** `SET LOCAL` is scoped to the transaction and is
 * discarded when it ends. A bare `SET` persists on the connection, and under
 * the transaction pooler that connection is handed to the next caller, who
 * would inherit somebody else's tenant. That is a cross-tenant read created by
 * a single missing keyword.
 *
 * **set_config with a parameter, never string interpolation.** The tenant id
 * arrives from a membership lookup, but building SQL by concatenation is a
 * habit that outlives the one safe call site. `set_config($1, $2, true)` is
 * parameterised, so a hostile value is data rather than syntax.
 */
@Injectable()
export class TenantTransactionService {
  private readonly logger = new Logger(TenantTransactionService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Runs `work` with the tenant context set for its transaction.
   *
   * Everything the callback does through the supplied manager is inside one
   * transaction, and every tenant-owned table is filtered to this tenant by
   * the database rather than by application code remembering a where clause.
   */
  async runInTenantContext<T>(
    tenantId: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (!UUID_PATTERN.test(tenantId)) {
      // The column is uuid, so a malformed value would fail at the cast inside
      // current_tenant_id() with a confusing error from deep in a policy.
      // Rejecting it here says what actually went wrong.
      throw new Error(`Refusing to open a tenant context for a non-uuid tenant id.`);
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      return work(manager);
    });
  }

  /**
   * Runs work with no tenant context at all.
   *
   * Every tenant-owned table returns zero rows here, because the policies
   * compare against NULL. Useful for genuinely cross-tenant operations on
   * tables that carry no policy, such as looking a school up by slug during
   * sign-in, before there is a tenant to be in the context of.
   *
   * Deliberately verbose to call. Reaching for this to "make a query work" is
   * a sign the query belongs in a tenant context instead.
   */
  async runWithoutTenantContext<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) => work(manager));
  }

  /**
   * Asserts at boot that the connected role cannot bypass row-level security.
   *
   * This is the check decision 18A exists for. Supabase's `postgres` role and
   * its service key both carry BYPASSRLS, so connecting with either produces a
   * system where every policy is inert and every test still passes. The failure
   * is invisible from the application's side, which is exactly why it has to be
   * asserted rather than assumed.
   *
   * This check is the one that matters, more than FORCE ROW LEVEL SECURITY on
   * the tables. FORCE binds policies to a table's owner, but a superuser or a
   * BYPASSRLS role bypasses regardless, which the integration suite pins
   * explicitly. So the guarantee rests on the connecting role, and that is
   * what this asserts.
   *
   * Refuses to boot outside development, because shipping this misconfigured
   * means no tenant isolation at all in production.
   */
  async assertRoleCannotBypassRls(nodeEnv: string): Promise<void> {
    const [row] = await this.dataSource.query<
      Array<{ role: string; bypassrls: boolean; superuser: boolean }>
    >(`
      SELECT rolname AS role, rolbypassrls AS bypassrls, rolsuper AS superuser
      FROM pg_roles
      WHERE rolname = current_user
    `);

    if (!row) {
      this.logger.warn('Could not determine the connected role; skipping the BYPASSRLS check.');
      return;
    }

    if (!row.bypassrls && !row.superuser) {
      this.logger.log(`Connected as "${row.role}", which cannot bypass row-level security.`);
      return;
    }

    const reason =
      `The application is connected as "${row.role}", which ` +
      `${row.superuser ? 'is a superuser' : 'has BYPASSRLS'}. ` +
      'Row-level security does not apply to this role, so every tenant policy is inert and ' +
      "one school can read another school's data. The test suite cannot detect this. " +
      'Connect as the restricted application role instead.';

    if (nodeEnv === 'development' || nodeEnv === 'test') {
      this.logger.warn(`${reason} Allowed here because NODE_ENV is "${nodeEnv}".`);
      return;
    }

    throw new Error(reason);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
