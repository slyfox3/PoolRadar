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
const augie = { name: 'Augie Gonzales', division: 'Funday Seniors', slug: 'fs' };
const augieEntry = { eventName: '2026 Fall Fun Day', division: 'Singles',
  players: [{ firstName: 'Augie', lastName: 'Gonzales', fargoRate: '541' }] };
lookup.enrich([augie], [augieEntry]);
assert.equal(augie.rating, 541);
assert.equal(lookup.memberLabel(augie.searchMembers[0]), 'Augie Gonzales (541)');
assert.deepEqual(lookup.memberInfoFor('Augie Gonzales', 'Singles', [augieEntry]), []);
const ratedTeam = lookup.registeredTeams([{ ...teamEntry,
  players: [{ firstName: 'Evan', lastName: 'Test', fargoRate: 0 },
    { firstName: 'Darla', lastName: 'Example', fargoRate: null }],
  alternatePlayers: [{ firstName: 'Alex', lastName: 'Alternate', fargoRate: '500' }] }])[0];
assert.equal(lookup.memberLabel(ratedTeam.searchMembers[0]), 'Evan Test (0)');
assert.equal(lookup.memberLabel(ratedTeam.searchMembers[1]), 'Darla Example');
assert.equal(lookup.memberLabel(ratedTeam.searchMembers[2]), 'Alex Alternate (500)');
for (const value of ['', ' ', 'invalid']) {
  assert.equal(lookup.memberInfoFor('Augie Gonzales', 'Funday Seniors', [{ ...augieEntry,
    players: [{ ...augieEntry.players[0], fargoRate: value }] }])[0].rating, null);
}

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
const renderContext = { searchReady: true, players, normal: (s) => String(s).toLowerCase(), wbcaSearch: lookup,
  marked: (name) => name, esc: (s) => s, document: { getElementById: (id) => elements[id] } };
vm.createContext(renderContext);
vm.runInContext(extract('wbca_2026.html', 'rankPlayers') + '\n' + extract('wbca_2026.html', 'renderSearch'), renderContext);
renderContext.renderSearch();
assert.match(elements['search-results'].innerHTML, /Test Team/);
assert.match(elements['search-results'].innerHTML, /Bracket not published yet/);
assert.ok(!elements['search-results'].innerHTML.includes('bracketbeast=null'));
renderContext.players = [augie];
elements['search-input'].value = 'Augie';
renderContext.renderSearch();
assert.match(elements['search-results'].innerHTML, /Augie Gonzales \(541\)/);
assert.equal((elements['search-results'].innerHTML.match(/Augie Gonzales/g) || []).length, 1);
renderContext.players = [ratedTeam];
elements['search-input'].value = 'Evan';
renderContext.renderSearch();
assert.match(elements['search-results'].innerHTML, /Evan Test \(0\)/);
assert.match(elements['search-results'].innerHTML, /Alex Alternate \(500\)/);

const indexResults = { innerHTML: '', scrollTop: 0 };
const indexContext = { searchInputEl: { value: 'Augie' }, currentTournament: {}, searchResultsEl: indexResults,
  buildSearchEntries: () => [{ kind: 'player', player: augie }], SEARCH_RESULT_CAP: 200,
  esc: (s) => String(s), highlightName: (name) => name, playerFlagHtml: () => '', isPlayerFav: () => false,
  wbcaSearch: lookup, currentSource: 'bracketbeast' };
vm.createContext(indexContext);
vm.runInContext(['teamRosterNote', 'renderSearchResults', 'fmPlayerCell', 'blockerPlayerLink']
  .map((name) => extract('index.html', name)).join('\n'), indexContext);
indexContext.renderSearchResults();
assert.match(indexResults.innerHTML, /Augie Gonzales \(541\)/);
assert.equal((indexResults.innerHTML.replace(/<[^>]*>/g, '').match(/Augie Gonzales/g) || []).length, 1);
indexContext.buildSearchEntries = () => [{ kind: 'player', player: ratedTeam }];
indexContext.renderSearchResults();
assert.match(indexResults.innerHTML, /Evan Test \(0\)/);
assert.match(indexResults.innerHTML, /Alex Alternate \(500\)/);
const ratedDoubles = { name: 'Gonzales/Kurz', searchMembers: [
  { name: 'Augie Gonzales', rating: 541 }, { name: 'Mike Kurz', rating: 496 },
] };
indexContext.currentTournament = { divisionName: 'Scotch Doubles 1100 & Under' };
assert.match(indexContext.teamRosterNote(ratedDoubles), /Augie Gonzales \(541\) \/ Mike Kurz \(496\)/);
assert.equal(ratedDoubles.name, 'Gonzales/Kurz');
assert.match(indexContext.fmPlayerCell('fm-p1', ratedDoubles, false, false, false), />Gonzales\/Kurz<\/span>/);
assert.ok(!indexContext.fmPlayerCell('fm-p1', ratedDoubles, false, false, false).includes('Augie'));
assert.match(indexContext.fmPlayerCell('fm-p1', ratedDoubles, false, false, false), /data-player="pg-gonzales\/kurz"/);
assert.ok(!indexContext.blockerPlayerLink(ratedDoubles).includes('Augie'));
indexContext.buildSearchEntries = () => [{ kind: 'player', player: ratedDoubles }];
indexContext.renderSearchResults();
assert.equal((indexResults.innerHTML.replace(/<[^>]*>/g, '').match(/Augie Gonzales/g) || []).length, 1);
indexContext.currentTournament = { divisionName: 'Teams 1375 & Under' };
assert.match(indexContext.teamRosterNote(ratedTeam), /Evan Test \(0\)/);
assert.match(indexContext.teamRosterNote(ratedTeam), /Alex Alternate \(500\)/);
indexContext.currentTournament = { divisionName: 'Funday Scotch Doubles' };
assert.match(indexContext.teamRosterNote(ratedDoubles), /Augie Gonzales \(541\)/);
indexContext.currentTournament = { divisionName: 'Singles' };
assert.equal(indexContext.teamRosterNote(augie), '');

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
