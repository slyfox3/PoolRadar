'use strict';
var adapter = require('./bracketbeast.js');
var passed = 0;
function assert(value, message) {
  if (!value) throw new Error(message);
  passed++;
}
function match(id, name, feeder, consolation, status, p1, p2) {
  return { id: id, matchName: name, feederMatchId: feeder || null,
    consolationMatchId: consolation || null, matchStatus: status || 'Scheduled',
    divisionPlayerId1: p1 ? id * 10 + 1 : null, divisionPlayer1Name: p1 || null,
    divisionPlayerId2: p2 ? id * 10 + 2 : null, divisionPlayer2Name: p2 || null,
    divisionPlayerId1Score: null, divisionPlayerId2Score: null,
    startTime: null, endTime: null, locationsDescription: null };
}

var result = adapter.buildResult({
  tournament: { name: 'Test Event', startDate: '2026-10-10', endDate: '2026-10-11',
    venueName: 'Test Hall', venueRegion: 'Oregon' },
  bracket: { tournamentId: 53, divisionId: 488, tournamentName: 'Test Event',
    divisionName: 'Open', bracketName: 'Double Elim', rounds: [
      { roundName: '1', roundSequence: 1, isWinnerRound: true, matches: [
        match(1, '1-1', null, 3, 'Scheduled', 'Alice', 'Bob') ] },
      { roundName: 'L1', roundSequence: 2, isWinnerRound: false, matches: [
        match(3, 'L1-1', 1, null, 'Bye', null, null) ] },
      { roundName: '2', roundSequence: 2, isWinnerRound: true, matches: [
        match(2, '2-1', 1, null, 'Scheduled', 'Carol', null) ] },
    ] },
}, 'https://player.bracketbeast.com/test');

assert(result.bracketByNum[1].winnerTo === 2, 'winner edge is inferred from feeder');
assert(result.bracketByNum[1].loserTo === 3, 'loser edge uses consolation match');
assert(result.bracketByNum[3].round === -1, 'loser round is canonical negative round');
assert(result.bracketByNum[3].is_bye, 'empty bye remains a routing node');
assert(result.matches.length === 1, 'TBD and empty routing rows do not create player cards');
assert(result.tournament.source === 'bracketbeast', 'source is namespaced');
assert(result.tournament.sourceUrl.indexOf('bracketbeast.com') > 0, 'source URL is retained');

// Regression: the sd1100 draw sends 17:45 without a zone for Chia/Yuan's
// first match, which is 10:45am at the Oregon venue (UTC-7).
function timedResult(status, startTime, endTime) {
  var m = match(74986, '1-50', null, null, status, 'Nicks/Su', 'Chia/Yuan');
  m.startTime = startTime;
  m.endTime = endTime;
  return adapter.buildResult({ rounds: [
    { roundName: '1', roundSequence: 1, isWinnerRound: true, matches: [m] },
  ] });
}
var scheduled = timedResult('Scheduled', '2026-10-11T17:45:00', null);
var iso = scheduled.matches[0].scheduledTime;
assert(iso === '2026-10-11T17:45:00Z', 'zone-less scheduled time is UTC');
assert(new Date(iso).toLocaleTimeString('en-US', {
  timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit',
}) === '10:45 AM', 'Chia/Yuan first match is 10:45am at the venue');
assert(scheduled.bracketByNum[74986].scheduledTime === iso, 'bracket schedule agrees with player card');
assert(scheduled.matches[0].startTime === null, 'scheduled match has no actual start');
var completed = timedResult('WinnerPlayer1', '2026-10-11T17:45:00', '2026-10-11T19:30:00');
assert(completed.matches[0].startTime === iso, 'actual start time is UTC');
assert(completed.bracketByNum[74986].startTime === iso, 'bracket actual start agrees with player card');
assert(completed.matches[0].updatedAt === '2026-10-11T19:30:00Z', 'end time is UTC');
assert(completed.matches[0].scheduledTime === null, 'completed match has no schedule');
['2026-10-11T17:45:00Z', '2026-10-11T10:45:00-07:00', '2026-10-11T10:45:00-0700'].forEach(function(value) {
  var explicit = timedResult('Scheduled', value, value);
  assert(explicit.matches[0].scheduledTime === value, 'explicit timezone is retained: ' + value);
  assert(explicit.matches[0].updatedAt === value, 'explicit end timezone is retained: ' + value);
});
assert(timedResult('Scheduled', null, null).matches[0].scheduledTime === null, 'missing time stays null');
console.log('Bracket Beast adapter: ' + passed + ' passed');

// By Match # keeps published tables after completion and before a match starts.
var fs = require('node:fs'), vm = require('node:vm');
var indexSource = fs.readFileSync('index.html', 'utf8');
function indexFunction(name) {
  var start = indexSource.indexOf('  function ' + name + '(');
  var end = indexSource.indexOf('\n  }', start);
  return indexSource.slice(start, end + 4);
}
var flatContext = {
  currentSource: 'bracketbeast', bracketByNum: {}, isPlayerFav: function() { return false; },
  playerFavBtn: function() { return ''; }, playerFlagHtml: function() { return ''; },
  buildBlockerMap: function() { return {}; }, buildShortNames: function() { return {}; },
  fmTbdCell: function() { return '<span>TBD</span>'; },
  esc: function(value) { return String(value); },
  matchTimeInfo: function(m) { return m.scheduledTime ? { title: 'Scheduled', label: '10:45am' } : null; },
};
vm.createContext(flatContext);
vm.runInContext(['pendingHalfFilled', 'fmPlayerCell', 'renderFlatMatches'].map(indexFunction).join('\n'), flatContext);
function tableMatch(num, status, table, s1, s2) {
  return { num: num, status: status, tableName: table, identifier: '1-' + num,
    p1: { name: 'Chia/Yuan' }, p2: { name: 'Other Team' }, s1: s1, s2: s2 };
}
var flatMatches = [tableMatch(1, 'COMPLETED', '64', 5, 3),
  tableMatch(2, 'NOT_STARTED', '68', null, null),
  tableMatch(3, 'IN_PROGRESS', 'Table 70', 1, 0)];
flatMatches[1].scheduledTime = '2026-10-11T17:45:00Z';
flatContext.bracketByNum[4] = { num: 4, status: 'NOT_STARTED', p1: { name: 'Waiting Team' }, p2: null, tableName: '72' };
var flatHtml = flatContext.renderFlatMatches(flatMatches);
assert(flatHtml.includes('class="fm-status">T64</span>'), 'completed match retains its table');
assert(flatHtml.includes('class="fm-status">T68</span>'), 'scheduled match shows its table');
assert(flatHtml.includes('class="fm-status mr-live">T70'), 'live match still shows its table');
assert(flatHtml.includes('class="fm-status">T72</span>'), 'half-filled bracket row retains its table');
assert(flatHtml.includes('class="mr-s1">5</span>'), 'completed score remains visible with its table');
console.log('Bracket Beast match table rendering: passed');

// Infer only one overdue ready match per free table, including other divisions.
var inferenceNow = Date.parse('2026-10-10T17:00:00Z');
function inferenceResult(rows) {
  var byNum = {};
  rows.forEach(function(row) { byNum[row.num] = row; });
  return { bracketByNum: byNum, matches: rows.map(function(row) { return Object.assign({}, row); }),
    tournament: { source: 'bracketbeast', status: 'NOT_STARTED' } };
}
function inferenceRow(num, status, table, time, ready) {
  return { num: num, status: status, tableName: table, scheduledTime: time,
    p1: { name: 'Team ' + num }, p2: ready === false ? null : { name: 'Opponent ' + num }, is_bye: false, startTime: null };
}
var inference = inferenceResult([
  inferenceRow(101, 'COMPLETED', '64', null),
  inferenceRow(102, 'NOT_STARTED', '64', '2026-10-10T16:00:00Z'),
  inferenceRow(103, 'NOT_STARTED', '64', '2026-10-10T16:30:00Z'),
  inferenceRow(104, 'NOT_STARTED', '65', '2026-10-10T18:00:00Z'),
  inferenceRow(105, 'NOT_STARTED', '66', '2026-10-10T16:00:00Z', false),
  inferenceRow(106, 'IN_PROGRESS', '67', null),
  inferenceRow(107, 'NOT_STARTED', '67', '2026-10-10T16:00:00Z'),
  inferenceRow(108, 'NOT_STARTED', null, '2026-10-10T16:00:00Z'),
]);
assert(adapter.inferInProgress(inference, [], inferenceNow) === 1, 'only earliest overdue match on a free table is inferred');
assert(inference.bracketByNum[102].inferredInProgress, 'free table after previous completion gets inferred fire');
assert(inference.matches.find(function(m) { return m.num === 102; }).status === 'IN_PROGRESS', 'visible match agrees with bracket node');
assert(inference.bracketByNum[102].startTime === null, 'inference does not invent an actual start timestamp');
[103, 104, 105, 107, 108].forEach(function(num) {
  assert(inference.bracketByNum[num].status === 'NOT_STARTED', 'blocked, future, unready or unassigned match stays scheduled: ' + num);
});
var occupiedOtherDivision = inferenceResult([inferenceRow(201, 'IN_PROGRESS', 'Table 64', null)]);
assert(adapter.inferInProgress(inference, [occupiedOtherDivision], inferenceNow) === 0, 'published live match in another division occupies the table');
assert(inference.bracketByNum[102].status === 'NOT_STARTED', 'inference is reversed when the table is occupied');
var earlierOtherDivision = inferenceResult([inferenceRow(202, 'NOT_STARTED', '64', '2026-10-10T15:00:00Z')]);
assert(adapter.inferInProgress(inference, [earlierOtherDivision], inferenceNow) === 0, 'earlier overdue match in another division reserves the table');
assert(earlierOtherDivision.bracketByNum[202].status === 'NOT_STARTED', 'other bracket source statuses are retained');
var multiTable = inferenceResult([inferenceRow(301, 'NOT_STARTED', '68-69', '2026-10-10T16:00:00Z')]);
assert(adapter.inferInProgress(multiTable, [inferenceResult([inferenceRow(302, 'IN_PROGRESS', '69', null)])], inferenceNow) === 0,
  'all tables of a multi-table match must be free');
assert(adapter.inferInProgress(multiTable, [], inferenceNow) === 1, 'multi-table match can start when every table is free');
assert(flatContext.renderFlatMatches([Object.assign(tableMatch(9, 'IN_PROGRESS', '64', null, null), { inferredInProgress: true })]).includes('Estimated from schedule, table and player availability'),
  'inferred fire has an explanation in By Match #');
console.log('Bracket Beast inferred live matches: passed');

// Rudranil cannot be inferred in two matches on different tables.
var firstRudranil = inferenceRow(401, 'NOT_STARTED', '45', '2026-10-10T16:00:00Z');
var secondRudranil = inferenceRow(402, 'NOT_STARTED', '41', '2026-10-10T16:30:00Z');
firstRudranil.p1.name = secondRudranil.p1.name = 'Rudranil Dutta';
var playerConflict = inferenceResult([firstRudranil, secondRudranil]);
assert(adapter.inferInProgress(playerConflict, [], inferenceNow) === 1, 'one inferred match per player even on different tables');
assert(playerConflict.bracketByNum[401].inferredInProgress, 'earliest match gets the player');
assert(playerConflict.bracketByNum[402].status === 'NOT_STARTED', 'later match waits for its player');
var liveRudranil = inferenceRow(403, 'IN_PROGRESS', '32', null);
liveRudranil.p1.name = 'RUDRANIL DUTTA';
assert(adapter.inferInProgress(playerConflict, [inferenceResult([liveRudranil])], inferenceNow) === 0,
  'published live match in another division reserves the player');
['Forfeit: Player 1', 'Forfeit: Player 2'].forEach(function(status, index) {
  var forfeited = timedResult(status, '2026-10-10T16:00:00', '2026-10-10T17:00:00');
  assert(forfeited.matches[0].status === 'COMPLETED', status + ' is completed');
  assert(forfeited.matches[0].isForfeit, status + ' has forfeit rendering');
  assert(forfeited.matches[0].p1Won === (index === 1), status + ' awards the other player');
  assert(adapter.inferInProgress(forfeited, [], inferenceNow) === 0, 'forfeit is not eligible for inferred fire');
});
console.log('Bracket Beast player conflicts and published forfeits: passed');

// Advancement settles a feeder even if the operator has not entered its win.
function advancedResult(status, winnerSide, loserSide) {
  var source = match(501, 'L2-2', null, 503, status, 'Ness/West', 'Frampton Jr/Frampton');
  source.divisionPlayerId1Score = '5';
  source.divisionPlayerId2Score = '3';
  source.startTime = '2026-10-10T16:00:00';
  source.locationsDescription = '39';
  function destination(id, side) {
    var dest = match(id, 'Next', 501, null, 'Scheduled', 'Other Team', side ? source['divisionPlayer' + side + 'Name'] : null);
    dest.divisionPlayerId2 = side ? source['divisionPlayerId' + side] : null;
    return dest;
  }
  return adapter.buildResult({ rounds: [
    { roundName: '1', roundSequence: 1, isWinnerRound: true, matches: [source] },
    { roundName: '2', roundSequence: 2, isWinnerRound: true, matches: [destination(502, winnerSide)] },
    { roundName: 'L1', roundSequence: 1, isWinnerRound: false, matches: [destination(503, loserSide)] },
  ] });
}
['Scheduled', 'Playing'].forEach(function(status) {
  var advanced = advancedResult(status, 1, 0);
  var row = advanced.bracketByNum[501];
  assert(row.status === 'COMPLETED' && row.p1Won && !row.p2Won, 'winner destination settles ' + status + ' feeder');
  assert(row.inferredWinnerFromAdvancement, 'derived result records its advancement evidence');
  assert(advanced.matches[0].status === 'COMPLETED' && advanced.matches[0].s1 === '5' && advanced.matches[0].s2 === '3',
    'visible match agrees and retains published scores');
  assert(adapter.inferInProgress(advanced, [], inferenceNow) === 0, 'advanced feeder cannot get inferred fire');
  assert(!require('./bracket-algo.js').buildBlockerMap(advanced.bracketByNum).blockedMatches[502],
    'advanced feeder no longer blocks the destination');
});
assert(advancedResult('Scheduled', 2, 0).bracketByNum[501].p2Won, 'advancement overrides a provisional score lead');
assert(advancedResult('Scheduled', 0, 1).bracketByNum[501].p2Won, 'loser destination establishes the opposite winner');
assert(advancedResult('Scheduled', 0, 0).bracketByNum[501].status === 'NOT_STARTED', 'no advancement leaves feeder pending');
assert(advancedResult('Scheduled', 1, 1).bracketByNum[501].status === 'NOT_STARTED', 'conflicting destinations do not fabricate a winner');
assert(advancedResult('WinnerPlayer2', 1, 0).bracketByNum[501].p2Won, 'explicit published result remains authoritative');
console.log('Bracket Beast advancement-derived winners: passed');
