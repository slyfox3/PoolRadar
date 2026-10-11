'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('wbca-search.js', 'utf8');
const snapshot = JSON.parse(fs.readFileSync('wbca_2026-search.json', 'utf8'));

function browser(initial, options = {}) {
  const storage = new Map(initial ? [['poolradar_wbca_2026_search_v1', initial]] : []);
  const calls = [];
  const context = {
    document: {}, URLSearchParams,
    localStorage: {
      getItem: key => { if (options.storageUnavailable) throw Error('disabled'); return storage.get(key) || null; },
      setItem: (key, value) => { if (options.storageUnavailable) throw Error('quota'); storage.set(key, value); },
    },
    fetch: async url => {
      calls.push(url);
      if (url === 'wbca_2026-search.json') {
        if (options.snapshotUnavailable) throw Error('offline');
        return { ok: true, json: async () => structuredClone(snapshot) };
      }
      const kind = new URL(url).searchParams.get('search').split('division:')[1];
      return { ok: true, json: async () => ({ total: 1, entries: snapshot.entries.filter(e => e.division === kind).slice(0, 1) }) };
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { lookup: context.wbcaSearch, calls, storage };
}

(async () => {
  const cached = browser(JSON.stringify(snapshot));
  for (const kind of ['Scotch', 'Singles', 'Teams']) {
    const entries = await cached.lookup.loadEntries('https://token-expired.invalid', kind);
    assert.equal(entries.length, snapshot.entries.filter(e => e.division === kind).length);
    assert(entries.every(e => e.division === kind));
  }
  assert.equal(cached.calls.length, 0, 'landing cache needs no download or API token');

  const direct = browser(null);
  const groups = await Promise.all(['Scotch', 'Teams', 'Singles'].map(kind => direct.lookup.loadEntries('https://token-expired.invalid', kind)));
  assert.equal(groups.reduce((n, entries) => n + entries.length, 0), snapshot.entries.length);
  assert.deepEqual(direct.calls, ['wbca_2026-search.json'], 'concurrent kinds share one bundled snapshot download');
  assert.equal(JSON.parse(direct.storage.get('poolradar_wbca_2026_search_v1')).players.length, snapshot.players.length);
  const members = direct.lookup.memberInfoFor('Chia/Yuan', 'Funday Scotch Doubles', groups[0]);
  assert(members.some(p => p.name === 'Arnie Yuan' && typeof p.rating === 'number'));

  const repeat = browser(direct.storage.get('poolradar_wbca_2026_search_v1'));
  await repeat.lookup.loadEntries('https://token-expired.invalid', 'Scotch');
  assert.equal(repeat.calls.length, 0, 'another page reuses persisted entries');

  for (const initial of ['{broken', JSON.stringify({ version: 1, entries: snapshot.entries.filter(e => e.division === 'Scotch') })]) {
    const corrupt = browser(initial);
    assert.equal((await corrupt.lookup.loadEntries('https://test.invalid', 'Teams')).length, groups[1].length);
    assert.deepEqual(corrupt.calls, ['wbca_2026-search.json']);
  }
  const noStorage = browser(null, { storageUnavailable: true });
  assert.equal((await noStorage.lookup.loadEntries('https://test.invalid', 'Scotch')).length, groups[0].length);
  assert.deepEqual(noStorage.calls, ['wbca_2026-search.json']);

  const fallback = browser(null, { snapshotUnavailable: true });
  assert.equal((await fallback.lookup.loadEntries('https://test.invalid', 'Scotch')).length, 1);
  assert.equal(fallback.calls.length, 2, 'unavailable snapshot falls back to the live API');
  console.log('Shared WBCA entries: landing cache, direct visit, concurrent loads, persistence, ratings, corrupt/partial storage, and live fallback passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
