'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const lookup = require('./wbca-search.js');

const entry = {
  eventName: '2026 Western BCA 9-Ball Championship', division: 'Scotch',
  divisionType: { fargoUp: 1100 }, teamName: 'Chia / Yuan',
  players: [{ firstName: 'Brian', lastName: 'Chia' }, { firstName: 'Arnie', lastName: 'Yuan' }],
};
const division = 'Scotch Doubles 1100 & Under';
assert.deepEqual(lookup.membersFor('Chia/Yuan', division, [entry]), ['Brian Chia', 'Arnie Yuan']);
assert.deepEqual(lookup.membersFor(' Yuan / Chia ', division, [entry]), ['Brian Chia', 'Arnie Yuan']);
assert.deepEqual(lookup.membersFor('Chia/Yuan', 'Scotch Doubles 900 & Under', [entry]), ['Brian Chia', 'Arnie Yuan']);
assert.deepEqual(lookup.membersFor('Yuan-Chia', division, [entry]), ['Brian Chia', 'Arnie Yuan']);
assert.deepEqual(lookup.membersFor('Chia/Yuan', division, [{ ...entry, teamName: 'Chia, / Yuan',
  players: [{ firstName: 'Brian', lastName: 'Chia,' }, entry.players[1]] }]), ['Brian Chia,', 'Arnie Yuan']);
assert.deepEqual(lookup.membersFor('Chia/Yuan', 'Singles', [entry]), []);
assert.deepEqual(lookup.membersFor('Chia/Yuan', division, [{ ...entry, eventName: '2025 Western BCA 9-Ball Championship' }]), []);
assert.deepEqual(lookup.membersFor('Chia/Yuan', division, [entry, {
  ...entry, players: [{ firstName: 'Another', lastName: 'Chia' }, entry.players[1]],
}]), []);
assert.deepEqual(lookup.membersFor('Chia/Yuan', division, [entry, entry]), ['Brian Chia', 'Arnie Yuan']);
const otherPair = { ...entry, divisionType: { fargoUp: 900 },
  players: [{ firstName: 'Other', lastName: 'Chia' }, { firstName: 'Different', lastName: 'Yuan' }] };
assert.deepEqual(lookup.membersFor('Chia/Yuan', division, [entry, otherPair]), ['Brian Chia', 'Arnie Yuan']);
assert.deepEqual(lookup.membersFor('Chia/Yuan', 'Scotch Doubles 800 & Under', [entry, otherPair]), []);
const funday = { ...entry, eventName: '2026 Fall Fun Day', divisionType: { fargoUp: 0 } };
assert.deepEqual(lookup.membersFor('Chia/Yuan', 'Funday Scotch Doubles', [entry, funday]), ['Brian Chia', 'Arnie Yuan']);
assert.deepEqual(lookup.membersFor('Chia/Yuan', 'Funday Scotch Doubles', [entry]), []);
assert.deepEqual(lookup.membersFor('Chia/Yuan', division, [funday]), []);
for (const cap of [800, 900, 1000, 1100]) {
  const name = 'Scotch Doubles ' + cap + ' & Under';
  assert.ok(lookup.isScotchDivision(name));
  assert.deepEqual(lookup.membersFor('Chia/Yuan', name, [{ ...entry, divisionType: { fargoUp: cap } }]), ['Brian Chia', 'Arnie Yuan']);
}
assert.ok(lookup.isScotchDivision('Funday Scotch Doubles'));
assert.ok(!lookup.isScotchDivision('Funday Singles'));
const teamEntry = { eventName: entry.eventName, division: 'Teams',
  divisionType: { name: '1375 & Under', fargoUp: 1375 }, teamName: 'Test Team ',
  players: [{ firstName: 'Evan', lastName: 'Test' }, { firstName: 'Darla', lastName: 'Example' }],
  alternatePlayers: [{ firstName: 'Alex', lastName: 'Alternate' }] };
assert.ok(lookup.isTeamDivision('Teams 1375 & Under'));
assert.deepEqual(lookup.membersFor('Test Team', 'Teams 1375 & Under', [teamEntry]), ['Evan Test', 'Darla Example', 'Alex Alternate']);
assert.deepEqual(lookup.membersFor('Test Team', 'Teams 1375 & Under', [{ ...teamEntry, eventName: '2025 Western BCA 9-Ball Championship' }]), []);
const registered = lookup.registeredTeams([teamEntry, teamEntry]);
assert.equal(registered.length, 1);
assert.equal(registered[0].slug, null);
assert.equal(registered[0].name, 'Test Team');
assert.equal(registered[0].searchNames.length, 3);

function extract(html, name) {
  const source = fs.readFileSync(html, 'utf8');
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, 'function exists: ' + name);
  const end = source.indexOf('\n  }', start);
  return source.slice(start, end + 4);
}
const players = lookup.enrich([{ name: 'Chia/Yuan', division, slug: 'sd1100' }], [entry]).concat(registered);
for (const html of ['wbca_2026.html', 'index.html']) {
  const context = { players, normal: (s) => String(s).toLowerCase(),
    collectSearchablePlayers: () => players };
  vm.createContext(context);
  vm.runInContext(extract(html, 'rankPlayers'), context);
  for (const query of ['Brian', 'Arnie', 'Arnie Yuan', 'Chia', 'Yuan', 'Chia/Yuan']) {
    assert.equal(context.rankPlayers(query)[0]?.name, 'Chia/Yuan', html + ': ' + query);
  }
  assert.equal(context.rankPlayers('Not A Member').length, 0);
  for (const query of ['Evan', 'Test Team', 'Darla Example', 'Alex Alternate']) {
    assert.ok(context.rankPlayers(query).some((p) => p.name === 'Test Team'), html + ': ' + query);
  }
}

const elements = { 'search-input': { value: 'Evan' }, 'search-results': { innerHTML: '' } };
const renderContext = { searchReady: true, players, normal: (s) => String(s).toLowerCase(),
  marked: (name) => name, esc: (s) => s, document: { getElementById: (id) => elements[id] } };
vm.createContext(renderContext);
vm.runInContext(extract('wbca_2026.html', 'rankPlayers') + '\n' + extract('wbca_2026.html', 'renderSearch'), renderContext);
renderContext.renderSearch();
assert.match(elements['search-results'].innerHTML, /Test Team/);
assert.match(elements['search-results'].innerHTML, /Bracket not published yet/);
assert.ok(!elements['search-results'].innerHTML.includes('bracketbeast=null'));

// Confirm card collection keeps full names and result activation retains the
// bracket team name, which is what jumpToPlayer uses to find the card.
const context = { currentMatches: [{ p1: { name: 'Chia/Yuan', searchNames: players[0].searchNames }, p2: null }],
  currentPlayerList: null, jumpToPlayer: (name) => { context.jumped = name; } };
vm.createContext(context);
vm.runInContext(extract('index.html', 'collectSearchablePlayers') + '\n' + extract('index.html', 'activateSearchEntry'), context);
assert.equal(context.collectSearchablePlayers()[0].searchNames[1], 'Arnie Yuan');
context.activateSearchEntry({ kind: 'player', player: context.collectSearchablePlayers()[0] });
assert.equal(context.jumped, 'Chia/Yuan');

async function checkLoading() {
  let requested = [];
  global.fetch = async (url) => {
    const u = new URL(url);
    requested.push(u);
    return new Response(JSON.stringify({ entries: Number(u.searchParams.get('page')) === 1 ? [entry] : [], total: 201 }));
  };
  const [a, b] = await Promise.all([lookup.loadEntries('https://test.invalid'), lookup.loadEntries('https://test.invalid')]);
  assert.equal(a, b);
  assert.equal(requested.length, 3);
  assert.equal(requested[0].searchParams.get('search'), 'general:,year:2026,division:Scotch');
  assert.deepEqual(requested.map((u) => u.searchParams.get('page')), ['1', '2', '3']);
  await lookup.loadEntries('https://test.invalid', 'Teams');
  assert.equal(requested.length, 6);
  assert.equal(requested[3].searchParams.get('search'), 'general:,year:2026,division:Teams');
  global.fetch = async () => new Response(JSON.stringify({ error: 'auth' }), { status: 401 });
  await assert.rejects(lookup.loadEntries('https://retry.invalid'), /auth/);
  global.fetch = async () => new Response(JSON.stringify({ entries: [entry], total: 1 }));
  assert.equal((await lookup.loadEntries('https://retry.invalid')).length, 1);
  console.log('WBCA full-name search passed: both pages, matching, ambiguity, navigation, pagination, auth retry.');
}
checkLoading().catch((error) => { console.error(error); process.exitCode = 1; });
