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
