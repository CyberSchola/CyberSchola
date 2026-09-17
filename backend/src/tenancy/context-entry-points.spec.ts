import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { Role } from '../auth/permission.matrix';
import * as requestContext from './request-context';
import {
  enterVerifiedJobContext,
  getRequestContext,
  runWithRequestContext,
} from './request-context';

const SRC = join(__dirname, '..');

/** Every non-test TypeScript file under src, as a path relative to src with forward slashes. */
function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }

    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts')
      ? [relative(SRC, full).split(sep).join('/')]
      : [];
  });
}

/** The files in src that mention an identifier at all. */
function filesReferencing(identifier: string): string[] {
  const pattern = new RegExp(`\\b${identifier}\\b`);

  return sourceFiles()
    .filter((file) => pattern.test(readFileSync(join(SRC, file), 'utf8')))
    .sort();
}

/**
 * Who may open a context, checked against the source itself.
 *
 * The ESLint rule enforces the same thing, and this exists so that the guarantee
 * does not depend on lint configuration: if the rule were loosened, deleted or
 * scoped wrongly, the unit suite would still fail the moment a third file
 * reached for a context opener. Review of BE-A02 asked for exactly that
 * property, that the low-level API cannot be mistaken for an entry point.
 */
describe('context entry points', () => {
  it('lets only TenantContextInterceptor open an HTTP request context', () => {
    expect(filesReferencing('runWithRequestContext')).toEqual([
      'tenancy/request-context.ts',
      'tenancy/tenant-context.interceptor.ts',
    ]);
  });

  it('lets only JobContextService open a job context', () => {
    expect(filesReferencing('enterVerifiedJobContext')).toEqual([
      'tenancy/job-context.service.ts',
      'tenancy/request-context.ts',
    ]);
  });

  it('no longer exports a primitive that accepts a caller-supplied tenant, actor and role', () => {
    // The API review flagged. Its absence is the point: a worker has no function
    // to call that turns arbitrary values into a tenant context.
    expect(Object.keys(requestContext)).not.toContain('runInJobContext');
    expect(filesReferencing('runInJobContext')).toEqual(['tenancy/request-context.ts']);
  });

  it('scans a real source tree, so the checks above are not vacuous', () => {
    expect(sourceFiles().length).toBeGreaterThan(20);
    expect(sourceFiles()).toContain('tenancy/job-context.service.ts');
  });
});

describe('runWithRequestContext', () => {
  it('opens an HTTP context', () => {
    const seen = runWithRequestContext({ origin: 'http', requestId: 'r' }, () =>
      getRequestContext(),
    );

    expect(seen?.origin).toBe('http');
  });

  it('refuses to open a job context, so it cannot fabricate background authorization', () => {
    expect(() =>
      runWithRequestContext(
        {
          origin: 'job',
          jobName: 'forged',
          tenantId: '11111111-2222-4333-8444-555555555555',
          userId: '22222222-3333-4444-8555-666666666666',
          roles: [Role.SchoolAdmin],
          requestId: 'r',
        },
        () => 'should not run',
      ),
    ).toThrow(/JobContextService\.runAsMember/);
  });
});

describe('enterVerifiedJobContext', () => {
  const verified = {
    jobName: 'nightly-roster-export',
    tenantId: '11111111-2222-4333-8444-555555555555',
    userId: '22222222-3333-4444-8555-666666666666',
    membershipId: '33333333-4444-4555-8666-777777777777',
    roles: [Role.Teacher],
  };

  it('opens a job context that records what the job was', () => {
    const seen = enterVerifiedJobContext(verified, () => getRequestContext());

    expect(seen).toMatchObject({
      origin: 'job',
      jobName: 'nightly-roster-export',
      tenantId: verified.tenantId,
      userId: verified.userId,
      roles: [Role.Teacher],
    });
  });

  it('does not leave the context open afterwards', () => {
    enterVerifiedJobContext(verified, () => undefined);

    expect(getRequestContext()).toBeUndefined();
  });

  it('refuses an unnamed job', () => {
    expect(() => enterVerifiedJobContext({ ...verified, jobName: '  ' }, () => 1)).toThrow(
      /jobName/,
    );
  });

  it.each(['not-a-uuid', ''])('refuses a tenant id of %p', (tenantId) => {
    expect(() => enterVerifiedJobContext({ ...verified, tenantId }, () => 1)).toThrow(/tenant id/i);
  });

  it.each(['not-a-uuid', ''])('refuses a user id of %p', (userId) => {
    expect(() => enterVerifiedJobContext({ ...verified, userId }, () => 1)).toThrow(/user id/i);
  });

  it('refuses a context with no membership behind it', () => {
    expect(() => enterVerifiedJobContext({ ...verified, membershipId: '' }, () => 1)).toThrow(
      /runAsMember/,
    );
  });

  it('refuses a role the matrix does not recognise, even beside a known one', () => {
    expect(() =>
      enterVerifiedJobContext(
        { ...verified, roles: [Role.Teacher, 'SUPER_ADMIN' as Role] },
        () => 1,
      ),
    ).toThrow(/roles/i);
  });

  it('refuses a job with no roles', () => {
    expect(() => enterVerifiedJobContext({ ...verified, roles: [] }, () => 1)).toThrow(/roles/i);
  });
});
