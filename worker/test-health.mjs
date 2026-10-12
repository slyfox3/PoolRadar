import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./src/index.js', import.meta.url), 'utf8');
const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
let wntStatus = 200, wbcaStatus = 200;
let calls = [];
globalThis.caches = { default: {
  match: async () => { throw Error('Health must bypass cache'); },
  put: async () => { throw Error('Health must not write cache'); },
} };
globalThis.fetch = async (url, options) => {
  url = new URL(url);
  calls.push({ url, options });
  if (url.hostname === 'www.wntlivescores.com') {
    if (url.pathname === '/login') return new Response('', { status: 302, headers: { 'set-cookie': 'wnt.live.sid=login-session; Path=/;' } });
    return new Response(JSON.stringify({ matches: [{ id: 1 }] }), { status: wntStatus });
  }
  assert.equal(url.hostname, 'api.members.westernbca.org');
  return new Response(JSON.stringify({ data: { total: 123, data: [] } }), { status: wbcaStatus });
};
const exp = Math.floor(Date.now() / 1000) + 3600;
function jwt(claims) { return 'e30.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature'; }
const env = { WNT_SESSION: 's%3Aopaque-secret-cookie', WBCA_TOKEN: jwt({ exp }) };
async function request(path = '/health', credentials = env) {
  return worker.fetch(new Request('https://proxy.test' + path, { headers: { Origin: 'https://slyfox3.github.io' } }), credentials, { waitUntil: () => {} });
}
let response = await request();
assert.equal(response.status, 200);
assert.equal(response.headers.get('Cache-Control'), 'no-store');
assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://slyfox3.github.io');
let out = await response.json();
assert(out.ok && out.checks.wnt.ok && out.checks.wbca.ok);
assert.deepEqual(Object.keys(out.checks).sort(), ['wbca', 'wnt']);
assert.equal(out.checks.wbca.expiresAt, new Date(exp * 1000).toISOString());
assert(out.checks.wbca.expiresInSeconds > 3500 && out.checks.wbca.expiresInSeconds <= 3600);
assert.equal(out.checks.wnt.expiresAt, null);
assert.equal(out.checks.wnt.expiresInSeconds, null);
assert(!JSON.stringify(out).includes(env.WBCA_TOKEN));
assert(!JSON.stringify(out).includes(env.WNT_SESSION));
assert.equal(calls.length, 2);
await request();
assert.equal(calls.length, 4, 'each aggregate request probes both providers');
wbcaStatus = 401;
response = await request();
out = await response.json();
assert.equal(response.status, 503);
assert(!out.ok && out.checks.wnt.ok && !out.checks.wbca.ok);
assert.equal(out.checks.wbca.expiresAt, new Date(exp * 1000).toISOString(), 'expiry remains available when upstream rejects the token');
wbcaStatus = 200; wntStatus = 302;
response = await request(); out = await response.json();
assert.equal(response.status, 503);
assert(!out.ok && !out.checks.wnt.ok && out.checks.wbca.ok, 'one failure does not hide the other result');
wntStatus = 200;
response = await request('/health', {}); out = await response.json();
assert.equal(response.status, 503);
assert(!out.checks.wnt.ok && !out.checks.wbca.ok);
assert.equal(out.checks.wbca.expiresAt, null);
response = await request('/health', { WBCA_TOKEN: env.WBCA_TOKEN, WNT_EMAIL: 'login@example.test', WNT_PASSWORD: 'password-secret' });
out = await response.json();
assert.equal(response.status, 200);
assert.equal(out.checks.wnt.credential, 'WNT_EMAIL/WNT_PASSWORD');
assert(!JSON.stringify(out).includes('password-secret'));
for (const path of ['/wnt/health', '/wbca/health']) {
  response = await request(path);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert((await response.json()).ok);
}
for (const [token, expected] of [
  ['malformed', null], [jwt({}), null], [jwt({ exp: 'tomorrow' }), null],
  [jwt({ exp: 1e100 }), null], [jwt({ exp: 1 }), '1970-01-01T00:00:01.000Z'],
]) {
  response = await request('/wbca/health', { WBCA_TOKEN: token });
  out = await response.json();
  assert.equal(out.expiresAt, expected);
  if (expected) assert.equal(out.expiresInSeconds, 0);
  assert(out.ok, 'expiry metadata does not replace upstream authentication');
}
console.log('Worker health: all credential checks, mixed failures, no cache, no secrets, JWT expiry, opaque sessions, and existing endpoints passed.');
