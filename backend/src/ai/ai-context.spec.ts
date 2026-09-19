import { runWithRequestContext } from '../tenancy/request-context';
import { resolveAiRequestContext } from './ai-context';

describe('resolveAiRequestContext', () => {
  it('builds context from the trusted RequestContext', () => {
    const result = runWithRequestContext(
      { origin: 'http', tenantId: 't1', userId: 'u1', role: 'TEACHER', requestId: 'r1' },
      () => resolveAiRequestContext(),
    );

    expect(result).toEqual({ tenantId: 't1', userId: 'u1', role: 'TEACHER', requestId: 'r1' });
  });

  it('throws rather than fabricating a context when no tenant is present', () => {
    expect(() =>
      runWithRequestContext({ origin: 'http', userId: 'u1', requestId: 'r1' }, () =>
        resolveAiRequestContext(),
      ),
    ).toThrow();
  });

  it('throws when there is no request context at all', () => {
    expect(() => resolveAiRequestContext()).toThrow();
  });
});