// Staging demo sign-in for CyberSchola. NEVER deployed with production.
//
// A public demo needs a way for a visitor to act as an administrator, a
// teacher, a parent, a pupil or a member of staff, without creating accounts.
// This is that way: a tiny token issuer with its own signing key, and a page
// that hands out a fresh token for each demo person.
//
// Why it is safe to exist:
// - It is not part of the API. It runs as its own process on the demo server.
// - The API only accepts its tokens because the staging configuration points
//   SUPABASE_URL and SUPABASE_JWKS_URL at it. Production refuses to boot with
//   any issuer that is not a Supabase project (see assertProductionIssuer in
//   src/config/env.validation.ts), so no production API can be told to trust it.
// - The people it signs in as exist only in the two demo schools the seed
//   creates, and those schools are rebuilt every night.
//
// No dependencies: signing uses Node's built-in crypto, so there is nothing to
// install and nothing in a lockfile to audit.
//
// Environment:
//   DEMO_AUTH_ISSUER_BASE  public base URL of this service, such as
//                          https://api-cyberschola.example.com/demo-auth
//   DEMO_AUTH_KEY_FILE     where the signing key is kept across restarts
//   DEMO_AUTH_PORT         port to listen on (default 3100)

import { createPrivateKey, generateKeyPairSync, createPublicKey, sign } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

// Keep in step with src/database/seeds/demo-users.ts. A unit test compares them.
export const DEMO_SCHOOL_ID = 'c5c10000-0000-4000-8000-000000000001';
export const DEMO_OTHER_SCHOOL_ID = 'c5c10000-0000-4000-8000-000000000002';
export const DEMO_USERS = [
  { key: 'admin', userId: 'd3300000-0000-4000-8000-000000000001', label: 'School administrator, Greenfield College' },
  { key: 'teacher', userId: 'd3300000-0000-4000-8000-000000000002', label: 'Adaeze Okonkwo, teacher and JSS 2 A form teacher' },
  { key: 'teacherParent', userId: 'd3300000-0000-4000-8000-000000000003', label: 'Obi Nwosu, teacher, and father of Tunde in JSS 2 B' },
  { key: 'parent', userId: 'd3300000-0000-4000-8000-000000000004', label: 'Funmi Abubakar, parent of Zainab' },
  { key: 'student', userId: 'd3300000-0000-4000-8000-000000000005', label: 'Zainab Abubakar, pupil in JSS 2 A' },
  { key: 'staff', userId: 'd3300000-0000-4000-8000-000000000006', label: 'Bayo Adewale, bursar (staff)' },
  { key: 'otherSchoolAdmin', userId: 'd3300000-0000-4000-8000-000000000007', label: 'Administrator of Brookvale Academy, a different school' },
];

const TOKEN_LIFETIME_SECONDS = 60 * 60;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** The signing key, created once and kept, so tokens survive a restart. */
function loadKey(file) {
  if (existsSync(file)) {
    return createPrivateKey({ key: JSON.parse(readFileSync(file, 'utf8')), format: 'jwk' });
  }

  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  writeFileSync(file, JSON.stringify(privateKey.export({ format: 'jwk' })), { mode: 0o600 });

  return privateKey;
}

export function createIssuer({ issuerBase, privateKey }) {
  const issuer = `${issuerBase.replace(/\/+$/, '')}/auth/v1`;
  const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' });
  const kid = `demo-${publicJwk.x.slice(0, 8)}`;

  /** A token shaped like a Supabase access token: ES256, same audience and claims. */
  function tokenFor(user, now = Math.floor(Date.now() / 1000)) {
    const header = { alg: 'ES256', typ: 'JWT', kid };
    const payload = {
      iss: issuer,
      aud: 'authenticated',
      sub: user.userId,
      role: 'authenticated',
      email: `${user.key.toLowerCase()}@demo.cyberschola.invalid`,
      iat: now,
      exp: now + TOKEN_LIFETIME_SECONDS,
    };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    const signature = sign('sha256', Buffer.from(signingInput), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    });

    return `${signingInput}.${signature.toString('base64url')}`;
  }

  const jwks = { keys: [{ ...publicJwk, kid, alg: 'ES256', use: 'sig' }] };

  return { issuer, jwks, tokenFor };
}

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(tokens) {
  const rows = tokens
    .map(
      ({ user, token }) => `
      <tr>
        <td><strong>${escape(user.label)}</strong><br><code>${escape(user.key)}</code></td>
        <td><code>${user.key === 'otherSchoolAdmin' ? DEMO_OTHER_SCHOOL_ID : DEMO_SCHOOL_ID}</code></td>
        <td><button data-token="${escape(token)}">Copy token</button></td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CyberSchola API demo</title>
<style>
  :root { color-scheme: light dark; --fg:#1b1f24; --bg:#f6f7f9; --card:#fff; --line:#d8dde3; --accent:#0b6bcb; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e6edf3; --bg:#0d1117; --card:#161b22; --line:#30363d; --accent:#58a6ff; } }
  body { margin:0; font:15px/1.55 system-ui, sans-serif; color:var(--fg); background:var(--bg); }
  main { max-width:960px; margin:0 auto; padding:32px 16px; }
  h1 { margin:0 0 4px; font-size:26px; } p { margin:8px 0; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:20px; margin:20px 0; }
  ol { padding-left:20px; } li { margin:6px 0; }
  table { width:100%; border-collapse:collapse; } td { padding:10px 8px; border-top:1px solid var(--line); vertical-align:top; }
  code { font:13px ui-monospace, monospace; word-break:break-all; }
  button, a.button { font:inherit; padding:7px 14px; border-radius:6px; border:1px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer; text-decoration:none; display:inline-block; }
  .note { font-size:13px; opacity:.8; }
</style></head>
<body><main>
  <h1>CyberSchola API: staging demo</h1>
  <p>A multi-tenant school platform. Every request is authenticated, confined to one school by row-level security, and narrowed to what the caller's role may see.</p>
  <p><a class="button" href="/api/docs">Open the API documentation</a></p>
  <div class="card">
    <strong>Try it as a real user</strong>
    <ol>
      <li>Copy a token below. Each is valid for one hour; reload this page for fresh ones.</li>
      <li>In the API documentation, press <strong>Authorize</strong> and paste it.</li>
      <li>Send the school id shown beside it as the <code>X-School-Id</code> header if the person belongs to more than one school. Every demo person here belongs to one, so this is optional.</li>
      <li>Try <code>GET /api/v1/students</code> as each person: the administrator sees the school, the teacher their pupils, the parent their child, and Brookvale's administrator none of Greenfield's.</li>
    </ol>
    <table>${rows}</table>
  </div>
  <p class="note">Demo data only. Greenfield College and Brookvale Academy are rebuilt every night at 03:00 UTC, so feel free to change things. These tokens are accepted only by this staging server.</p>
</main>
<script>
  for (const button of document.querySelectorAll('button[data-token]')) {
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(button.dataset.token);
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = 'Copy token'), 1500);
    });
  }
</script>
</body></html>`;
}

function serve({ issuerBase, keyFile, port }) {
  const { jwks, tokenFor } = createIssuer({ issuerBase, privateKey: loadKey(keyFile) });

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname.replace(/^\/demo-auth/, '') || '/';
    const send = (status, type, body) => {
      response.writeHead(status, {
        'content-type': type,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      });
      response.end(body);
    };

    if (request.method !== 'GET') {
      return send(405, 'text/plain', 'Method not allowed');
    }

    if (path === '/jwks.json' || path === '/auth/v1/.well-known/jwks.json') {
      return send(200, 'application/json', JSON.stringify(jwks));
    }

    const tokens = DEMO_USERS.map((user) => ({ user, token: tokenFor(user) }));

    if (path === '/tokens.json') {
      return send(
        200,
        'application/json',
        JSON.stringify(
          Object.fromEntries(tokens.map(({ user, token }) => [user.key, { label: user.label, token }])),
          null,
          2,
        ),
      );
    }

    if (path === '/' || path === '') {
      return send(200, 'text/html; charset=utf-8', page(tokens));
    }

    return send(404, 'text/plain', 'Not found');
  });

  server.listen(port, '0.0.0.0', () => console.log(`demo-auth listening on ${port}`));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.mjs')) {
  const issuerBase = process.env.DEMO_AUTH_ISSUER_BASE;

  if (!issuerBase) {
    console.error('DEMO_AUTH_ISSUER_BASE is required, such as https://api.example.com/demo-auth');
    process.exit(1);
  }

  serve({
    issuerBase,
    keyFile: process.env.DEMO_AUTH_KEY_FILE ?? '/home/node/demo-auth-key.json',
    port: Number(process.env.DEMO_AUTH_PORT ?? 3100),
  });
}
