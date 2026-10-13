'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const adapter = require('./bracketbeast.js');
const ids = { Alpha: 101, Beta: 102, Gamma: 103, Undefeated: 104, Challenger: 105, Third: 106 };
function match(id, p1, p2, status = 'Scheduled', consolation = null) {
  return { id, playSequence: 1, matchName: 'Match ' + id, matchStatus: status,
    divisionPlayerId1: ids[p1] || null, divisionPlayer1Name: p1 || null,
    divisionPlayerId2: ids[p2] || null, divisionPlayer2Name: p2 || null,
    consolationMatchId: consolation };
}
function round(name, winner, matches, lo, hi, options = {}) {
  return { roundName: name, roundSequence: Number(name.replace(/^[LF]/, '')) + (/^F/.test(name) ? 7 : 0), isWinnerRound: winner,
    minimumPlace: lo, maximumPlace: hi, matches, ...options };
}
function result(rounds) { return adapter.buildResult({ rounds }); }
function places(data, name) {
  return Object.values(data.bracketByNum).flatMap(m => [m.p1, m.p2]).filter(p => p && p.name === name).map(p => p.place);
}
let data = result([
  round('1', true, [match(1, 'Alpha', 'Beta', 'WinnerPlayer1', 2)], 9, 12),
  round('L8', false, [match(2, 'Beta', 'Gamma', 'WinnerPlayer2')], 9, 12),
]);
assert.deepEqual(places(data, 'Beta'), ['9-12', '9-12'], 'elimination place appears in all earlier matches too');
assert.deepEqual(places(data, 'Gamma'), [null], 'winning a losers round does not assign its elimination place');
assert.deepEqual(places(data, 'Alpha'), [null]);
assert.equal(data.matches[0].p2.place, '9-12', 'visible match objects carry the same placing');
const pending = match(2, 'Beta', 'Gamma', 'Printed');
pending.divisionPlayerId1Score = 5;
pending.divisionPlayerId2Score = 1;
assert.deepEqual(places(result([round('L8', false, [pending], 9, 12)]), 'Gamma'), [null], 'scores alone do not settle a placing');
assert.deepEqual(places(result([round('L8', false, [match(2, 'Beta', 'Gamma', 'Forfeit: Player1')], 9, 12)]), 'Beta'), ['9-12']);
assert.deepEqual(places(result([round('L8', false, [match(2, 'Beta', 'Gamma', 'WinnerPlayer2')], 0, 0)]), 'Beta'), [null]);
const advanced = result([
  round('L8', false, [match(2, 'Beta', 'Gamma')], 9, 12),
  round('L9', false, [match(3, 'Gamma', null)], 7, 8),
]);
assert(advanced.bracketByNum[2].inferredWinnerFromAdvancement);
assert.equal(advanced.bracketByNum[2].p1.place, '9-12', 'advancement-derived winners settle elimination places too');
function finals(f1Status, f2Status = 'Scheduled') {
  return result([
    round('7', true, [match(7, 'Undefeated', 'Third', 'WinnerPlayer1', 12)], 0, 0),
    round('L12', false, [match(12, 'Challenger', 'Third', 'WinnerPlayer1')], 3, 3),
    round('F1', true, [match(13, 'Undefeated', 'Challenger', f1Status)], 1, 2, { roundOutputType: 'ConditionalFinal' }),
    round('F2', true, [match(14, f1Status === 'WinnerPlayer2' ? 'Challenger' : null,
      f1Status === 'WinnerPlayer2' ? 'Undefeated' : null, f2Status)], 1, 2, { isDoubleFinal: true, roundOutputType: 'Final' }),
  ]);
}
data = finals('WinnerPlayer1');
assert(places(data, 'Undefeated').every(p => p === '1'), 'undefeated finalist wins title in F1');
assert(places(data, 'Challenger').every(p => p === '2'));
assert(places(data, 'Third').every(p => p === '3'));
data = finals('WinnerPlayer2');
assert(places(data, 'Undefeated').every(p => p === null), 'F1 loss awaiting reset has no final placing');
assert(places(data, 'Challenger').every(p => p === null));
data = finals('WinnerPlayer2', 'WinnerPlayer1');
assert(places(data, 'Challenger').every(p => p === '1'), 'reset final determines champion');
assert(places(data, 'Undefeated').every(p => p === '2'));
data = result([round('1', true, [match(1, 'Alpha', 'Beta', 'WinnerPlayer1')], 1, 2, { roundOutputType: 'Final' })]);
assert.equal(data.matches[0].p1.place, '1', 'single final winner');
assert.equal(data.matches[0].p2.place, '2', 'single final runner-up');

// Verify the existing By Player renderer displays the adapter's place field.
const html = fs.readFileSync('index.html', 'utf8');
function extract(name) {
  const start = html.indexOf('  function ' + name + '(');
  return html.slice(start, html.indexOf('\n  }', start) + 4);
}
const context = { currentSource: 'bracketbeast', currentTournament: data.tournament, bracketByNum: data.bracketByNum,
  countryFilter: null, liveOnly: false, pinnedPlayers: {}, showBlockers: false,
  buildBlockerMap: () => ({}), isPlayerCardFav: () => false, hasTeamRosterView: () => false,
  playerFavBtn: () => '', teamRosterNote: () => '', playerFlagHtml: () => '', esc: value => String(value),
  matchTimeInfo: () => null };
vm.createContext(context);
vm.runInContext(['pendingHalfFilled', 'addPlayerMatch', 'renderGroupedByPlayer'].map(extract).join('\n'), context);
const cards = context.renderGroupedByPlayer(data.matches);
assert.match(cards, /Place: 1<\/span>/);
assert.match(cards, /Place: 2<\/span>/);
const eliminated = result([round('L8', false, [match(2, 'Beta', 'Gamma', 'WinnerPlayer2')], 9, 12)]);
context.bracketByNum = eliminated.bracketByNum;
assert.match(context.renderGroupedByPlayer(eliminated.matches), /Place: 9-12<\/span>/);
console.log('Bracket Beast places: elimination bands, all appearances, forfeits, pending scores, advancement, conditional/reset finals, and card rendering passed.');
