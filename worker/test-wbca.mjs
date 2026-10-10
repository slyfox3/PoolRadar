import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./src/index.js', import.meta.url), 'utf8');
const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const token = 'test-token';
let upstreamStatus = 200;
let calls = [];
const cached = new Map();
globalThis.caches = { default: {
  match: async (key) => cached.get(key.url)?.clone(),
  put: async (key, value) => { cached.set(key.url, value.clone()); },
} };
globalThis.fetch = async (url, options) => {
  calls.push({ url: new URL(url), options });
  return new Response(JSON.stringify({ data: { total: 1373, data: [{
    firstName: 'Private registrant', note: 'Private note', price: 100,
    order: { email: 'private@example.test' },
    orderItem: { teamName: 'Test team', event: { name: 'Test Event' },
      division: { name: 'Scotch Doubles' },
      divisionType: { name: '1100', eventType: 'Doubles', fargoUp: 1100, fargoDown: 0 } },
    detailsJSON: JSON.stringify([
      { type: 'player', firstName: 'Alice', lastName: 'Test', fargoRate: 0, robustness: 0,
        csi: 'private-id', primaryLeague: 'private-league' },
      { type: 'alternativePlayer', firstName: 'Bob', lastName: 'Test', fargoRate: 500, robustness: 200 },
    ]),
  }] } }), { status: upstreamStatus });
};
async function request(path = '/wbca/entries', env = { WBCA_TOKEN: token }, options = {}) {
  const pending = [];
  const response = await worker.fetch(new Request('https://proxy.test' + path, options),
    env, { waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);
  return response;
}

let response = await request('/wbca/entries?search=general:Alice&page=2&limit=25', undefined,
  { headers: { Origin: 'https://slyfox3.github.io', 'If-None-Match': 'old-etag' } });
assert.equal(response.status, 200);
assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://slyfox3.github.io');
const payload = await response.json();
assert.equal(payload.total, 1373);
assert.equal(payload.page, 2);
assert.equal(payload.limit, 25);
assert.deepEqual(payload.entries[0].players, [{ firstName: 'Alice', lastName: 'Test', fargoRate: 0, robustness: 0 }]);
assert.equal(payload.entries[0].alternatePlayers[0].firstName, 'Bob');
assert.equal(payload.entries[0].divisionType.fargoDown, 0);
assert.ok(!JSON.stringify(payload).includes('private'));
assert.equal(calls[0].url.origin, 'https://api.members.westernbca.org');
assert.equal(calls[0].url.searchParams.get('search'), 'general:Alice');
assert.equal(calls[0].options.headers.Authorization, 'Bearer ' + token);
assert.ok(!('If-None-Match' in calls[0].options.headers));
assert.equal(calls[0].options.redirect, 'manual');
response = await request('/wbca/entries?search=general:Alice&page=2&limit=25');
assert.equal(response.headers.get('X-Cache'), 'HIT');
assert.equal(calls.length, 1);
response = await request();
assert.equal(response.status, 200);
assert.equal(calls[1].url.searchParams.get('search'), 'general:');
assert.equal(calls[1].url.searchParams.get('page'), '1');
assert.equal(calls[1].url.searchParams.get('limit'), '50');

cached.clear();
response = await request('/wbca/entries', {});
assert.equal(response.status, 401);
assert.match((await response.json()).message, /WBCA_TOKEN/);
upstreamStatus = 401;
response = await request();
assert.equal(response.status, 401);
assert.match((await response.json()).message, /Replace it/);
assert.equal(cached.size, 0);
upstreamStatus = 403;
assert.equal((await request()).status, 401);
upstreamStatus = 500;
assert.equal((await request()).status, 502);
for (const query of ['page=0', 'page=1.5', 'limit=101', 'limit=-1', 'search=' + 'a'.repeat(501)]) {
  assert.equal((await request('/wbca/entries?' + query)).status, 400);
}
assert.equal((await request('/wbca/entries', undefined, { method: 'POST' })).status, 405);
assert.equal((await request('/wbca/entries', undefined, { headers: { Origin: 'https://other.test' } })).status, 403);
console.log('WBCA proxy checks passed: fields, auth, cache, pagination, search, errors, CORS.');
