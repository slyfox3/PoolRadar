'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const wbcaSearch = require('./wbca-search.js');
const playerSearch = require('./player-search.js');
const { buildResult } = require('./bracketbeast.js');
const { buildBracketIndex, stageOf } = require('./bracket-algo.js');
const source = fs.readFileSync('graph.html', 'utf8');
function extract(name) {
  const match = new RegExp('(?:async )?function ' + name + '\\(').exec(source);
  assert.ok(match, name + ' exists');
  const end = source.indexOf('\n}', match.index);
  return source.slice(match.index, end + 2);
}
async function checkDivision(division, kind, teamName, players, alternates) {
  let requestedKind, selected;
  const entry = { eventName: '2026 Western BCA 9-Ball Championship', division: kind,
    divisionType: { name: '1000 & Under', fargoUp: 1000 }, teamName,
    players, alternatePlayers: alternates };
  const payload = { bracket: { tournamentId: 53, divisionId: 777, divisionName: division,
    rounds: [{ roundName: '1', roundSequence: 1, isWinnerRound: true, matches: [{ id: 1,
      matchName: 'W1-1', matchStatus: 'Scheduled', playSequence: 1,
      locationsDescription: '64', startTime: '2026-10-11T17:45:00',
      divisionPlayerId1: 11, divisionPlayer1Name: teamName,
      divisionPlayerId2: 12, divisionPlayer2Name: 'Other Team' }] }] } };
  const elements = { 'player-list': { innerHTML: '' }, 'player-input': { value: players[0].firstName } };
  const c = { playerSearch, state: {}, SEARCH_CAP: 12, searchHits: [], searchCursor: -1,
    $: id => elements[id], reEsc: s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), esc: s => String(s), searchFlagHtml: () => '', BRACKETBEAST_PROXY: 'http://test/bracketbeast',
    bracketBeastBuildResult: buildResult, buildBracketIndex, stageOf,
    wbcaSearch: { ...wbcaSearch, loadEntries: async (base, divisionKind) => {
      requestedKind = divisionKind; return [entry];
    } }, fetch: async () => ({ ok: true, json: async () => payload }),
    buildCountryView: () => [], select: name => { selected = name; } };
  vm.createContext(c);
  const canon = source.slice(source.indexOf('const canonRow ='), source.indexOf('\n});', source.indexOf('const canonRow =')) + 4);
  vm.runInContext(canon + '\nconst runKey = a => stageOf(a.round) * 1000 + a.num;\n' +
    ['fetchBracketBeast', 'bracketBeastRows', 'buildPlayerView', 'setRows', 'rankPlayers', 'activateEntry', 'renderResults'].map(extract).join('\n'), c);
  const result = await c.fetchBracketBeast('53/777/888');
  assert.equal(requestedKind, kind);
  c.setRows(c.bracketBeastRows(result));
  c.buildSearchEntries = query => c.rankPlayers(query).map(player => ({ kind: 'player', player }));
  c.renderResults();
  const resultHtml = elements['player-list'].innerHTML.replace(/<[^>]*>/g, '');
  assert.ok(resultHtml.includes(teamName));
  assert.ok(elements['player-list'].innerHTML.includes('class="pse-schedule"'));
  assert.ok(resultHtml.includes('T64'));
  assert.ok(resultHtml.includes('Oct 11'));
  assert.ok(resultHtml.includes(String(players.reduce((sum, p) => sum + p.fargoRate, 0))));
  for (const member of players.concat(alternates)) assert.ok(resultHtml.includes(member.firstName + ' ' + member.lastName + ' (' + member.fargoRate + ')'));
  for (const member of players.concat(alternates)) {
    for (const query of [member.firstName, member.lastName, member.firstName + ' ' + member.lastName]) {
      const hits = c.rankPlayers(query);
      assert.equal(hits.length, 1, query + ' finds one team');
      assert.equal(hits[0].name, teamName);
      c.activateEntry({ kind: 'player', player: hits[0] });
      assert.equal(selected, teamName, 'select keeps bracket team name');
    }
  }
}
// Choose the earliest unstarted match, regardless of bracket traversal order.
const schedulePlayer = { name: 'Chia/Yuan' };
playerSearch.applySchedules([schedulePlayer], [
  { p1: schedulePlayer, status: 'COMPLETED', tableName: '64', scheduledTime: '2026-10-10T16:00:00Z' },
  { p1: schedulePlayer, status: 'NOT_STARTED', tableName: '8', scheduledTime: '2026-10-11T20:00:00Z' },
  { p1: schedulePlayer, status: 'NOT_STARTED', tableName: '4', scheduledTime: '2026-10-11T17:45:00Z' },
]);
assert.equal(schedulePlayer.scheduledMatch.tableName, '4');
assert.match(playerSearch.renderResults([{ kind: 'player', player: schedulePlayer }], {}), /pse-schedule/);
playerSearch.applySchedules([schedulePlayer], []);
assert.equal(schedulePlayer.scheduledMatch, undefined);

(async () => {
  await checkDivision('Scotch Doubles 1000 & Under', 'Scotch', 'Gonzales/Kurz', [
    { firstName: 'Augie', lastName: 'Gonzales', fargoRate: 541 },
    { firstName: 'Mike', lastName: 'Kurz', fargoRate: 450 },
  ], []);
  await checkDivision('Teams 1000 & Under', 'Teams', 'Future Team', [
    { firstName: 'Evan', lastName: 'Olson', fargoRate: 300 },
    { firstName: 'Jeff', lastName: 'Heiss', fargoRate: 300 },
    { firstName: 'Darla', lastName: 'Rundle', fargoRate: 300 },
  ], [{ firstName: 'Alex', lastName: 'Alternate', fargoRate: 250 }]);
  console.log('Graph member search passed: doubles, future Teams brackets, alternates, and team selection.');
})();
