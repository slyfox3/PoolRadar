import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./src/index.js', import.meta.url), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
let instance = 0;
async function newWorker() { return (await import(moduleUrl + '#refresh-test-' + (++instance))).default; }
const originalNow = Date.now;
let now = originalNow();
Date.now = () => now;
const jwt = (claims) => 'e30.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';
const env = { WBCA_REFRESH_TOKEN: jwt({ exp: Math.floor(now / 1000) + 30 * 86400, type: 'refresh' }) };
let calls = [], minted = [], refreshStatus = 200, denyAllEntries = false, invalidPayload = false;
const deniedTokens = new Set();
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async (url, options) => {
  url = new URL(url);
  calls.push({ url, options });
  if (url.pathname === '/api/v1/user/refresh-token') {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.cache, 'no-store');
    assert(!options.headers.Authorization, 'refresh must work after WBCA_TOKEN is removed');
    if (refreshStatus !== 200) return new Response('{}', { status: refreshStatus });
    if (invalidPayload) return new Response(JSON.stringify({ data: {} }));
    const accessToken = jwt({ exp: Math.floor(now / 1000) + 3600, generation: minted.length });
    minted.push(accessToken);
    return new Response(JSON.stringify({ data: { accessToken, tokenExpireTime: now + 3600000 } }));
  }
  assert.equal(url.pathname, '/api/v1/eventEntries');
  assert.equal(options.cache, 'no-store');
  const token = options.headers.Authorization.slice('Bearer '.length);
  assert(minted.includes(token), 'entries use an access token, never the refresh token');
  if (denyAllEntries || deniedTokens.has(token)) return new Response('{}', { status: 401 });
  return new Response(JSON.stringify({ data: { total: 1199, data: [] } }));
};
const refreshCount = () => calls.filter(c => c.url.pathname.endsWith('/refresh-token')).length;
const entryCount = () => calls.filter(c => c.url.pathname.endsWith('/eventEntries')).length;
async function request(worker, path = '/wbca/entries', credentials = env) {
  const jobs = [];
  const response = await worker.fetch(new Request('https://proxy.test' + path), credentials,
    { waitUntil: p => jobs.push(p) });
  await Promise.all(jobs);
  return response;
}
try {
  let worker = await newWorker();
  let response = await request(worker);
  assert.equal(response.status, 200);
  assert.equal(refreshCount(), 1);
  assert.equal(entryCount(), 1);
  assert.deepEqual(JSON.parse(calls[0].options.body), { refreshToken: env.WBCA_REFRESH_TOKEN });
  await request(worker);
  assert.equal(refreshCount(), 1, 'valid access token stays in isolate memory');
  worker = await newWorker(); calls = [];
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => request(worker)));
  assert(concurrent.every(r => r.status === 200));
  assert.equal(refreshCount(), 1, 'parallel cold requests share one refresh');
  now += 3600000;
  await request(worker);
  assert.equal(refreshCount(), 2, 'expired access token refreshes automatically');
  const beforeRefresh = refreshCount(), beforeEntries = entryCount();
  deniedTokens.add(minted.at(-1));
  assert.equal((await request(worker)).status, 200);
  assert.equal(refreshCount(), beforeRefresh + 1);
  assert.equal(entryCount(), beforeEntries + 2, '401 refreshes and retries the read once');
  denyAllEntries = true;
  const deniedBefore = entryCount();
  assert.equal((await request(worker)).status, 401);
  assert.equal(entryCount(), deniedBefore + 2, 'persistent denial cannot loop');
  denyAllEntries = false;
  response = await request(worker, '/wbca/health');
  let health = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(health.credential, 'WBCA_REFRESH_TOKEN');
  assert.deepEqual(health.present, { WBCA_REFRESH_TOKEN: true, WBCA_TOKEN: false });
  assert.equal(health.expiresAt, new Date(now + 3600000).toISOString().replace(/\.\d{3}Z$/, '.000Z'));
  assert.equal(health.refreshExpiresAt, new Date(JSON.parse(Buffer.from(env.WBCA_REFRESH_TOKEN.split('.')[1], 'base64url')).exp * 1000).toISOString());
  assert(!JSON.stringify(health).includes(env.WBCA_REFRESH_TOKEN));
  assert(!minted.some(token => JSON.stringify(health).includes(token)));
  const healthBefore = refreshCount();
  await request(worker, '/wbca/health');
  assert.equal(refreshCount(), healthBefore + 1, 'health validates the refresh token itself');
  refreshStatus = 401;
  response = await request(worker, '/wbca/health'); health = await response.json();
  assert.equal(response.status, 503);
  assert.equal(health.error, 'auth');
  assert.match(health.message, /WBCA_REFRESH_TOKEN/);
  refreshStatus = 200;
  assert.equal((await request(worker, '/wbca/health')).status, 200, 'failed refresh promise does not poison future attempts');
  const nextEnv = { WBCA_REFRESH_TOKEN: 'replacement-refresh-secret' };
  const rotationBefore = refreshCount();
  assert.equal((await request(worker, '/wbca/entries', nextEnv)).status, 200);
  assert.equal(refreshCount(), rotationBefore + 1, 'rotated secrets invalidate the old access token cache');
  assert.equal(JSON.parse(calls.findLast(c => c.url.pathname.endsWith('/refresh-token')).options.body).refreshToken, nextEnv.WBCA_REFRESH_TOKEN);
  invalidPayload = true;
  assert.equal((await request(await newWorker())).status, 502);
  invalidPayload = false; refreshStatus = 500;
  response = await request(await newWorker(), '/wbca/health'); health = await response.json();
  assert.equal(response.status, 503);
  assert.equal(health.error, 'upstream');
  console.log('WBCA refresh: refresh-only configuration, caching, concurrent requests, expiry, bounded 401 retry, health/expiry, secret rotation, and recovery passed.');
} finally { Date.now = originalNow; }
