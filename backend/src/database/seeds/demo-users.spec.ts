import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEMO_OTHER_SCHOOL_ID, DEMO_SCHOOL_ID, DEMO_USERS } from './demo-users';

/**
 * The seed and the staging demo sign-in are separate programs that must agree
 * on who the demo people are: the seed gives each id a membership, and the
 * sign-in issues tokens for the same ids. The sign-in runs without this package,
 * so it keeps its own copy, and this reads that copy as text and holds the two
 * equal. A token for an id the seed never created would sign in as nobody.
 */
describe('the demo people', () => {
  const server = readFileSync(
    join(__dirname, '..', '..', '..', 'deploy', 'staging', 'demo-auth', 'server.mjs'),
    'utf8',
  );

  it('are the same people in the seed and in the demo sign-in', () => {
    const pairs = [...server.matchAll(/\{ key: '(\w+)', userId: '([0-9a-f-]{36})'/g)].map(
      ([, key, userId]) => ({ key, userId }),
    );

    expect(pairs).toEqual(DEMO_USERS.map(({ key, userId }) => ({ key, userId })));
  });

  it('name the same two schools', () => {
    expect(server).toContain(`DEMO_SCHOOL_ID = '${DEMO_SCHOOL_ID}'`);
    expect(server).toContain(`DEMO_OTHER_SCHOOL_ID = '${DEMO_OTHER_SCHOOL_ID}'`);
  });

  it('never reuse an id', () => {
    expect(new Set(DEMO_USERS.map((user) => user.userId)).size).toBe(DEMO_USERS.length);
  });
});
