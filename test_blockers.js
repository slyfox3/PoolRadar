// Run with:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc bracket-algo.js test_blockers.js
'use strict';
if (typeof console === 'undefined') {
  var console = { log: function(s) { print(s); }, error: function(s) { print(s); } };
}
if (typeof require === 'function') {
  var algo = require('./bracket-algo.js');
  var followTo = algo.followTo;
  var buildBlockerMap = algo.buildBlockerMap;
  var getBlockersForPlayer = algo.getBlockersForPlayer;
  var getNextPlaysInfo = algo.getNextPlaysInfo;
}
// When loaded via jsc with bracket-algo.js first, functions are already global.

var passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}

function M(num, p1, p2, opts) {
  opts = opts || {};
  return {
    num: num, is_bye: !!opts.bye, identifier: opts.id || null,
    p1: p1 ? { name: p1, rating: null } : null,
    p2: p2 ? { name: p2, rating: null } : null,
    s1: opts.s1 || null, s2: opts.s2 || null,
    p1Won: !!opts.p1Won, p2Won: !!opts.p2Won,
    winnerTo: opts.wTo || null, loserTo: opts.lTo || null,
    status: opts.status || 'NOT_STARTED',
  };
}

function pd(name) {
  return { player: { name: name }, matches: [{ status: 'COMPLETED', num: 0 }] };
}

function toObj(list) {
  var o = {};
  for (var i = 0; i < list.length; i++) o[list[i].num] = list[i];
  return o;
}

// ═══════════════════════════════════════════════
// A1: Both resolved, no bye
// M1(Bob,Carol) →W→ M2(Alice,??)
// ═══════════════════════════════════════════════
(function() {
  console.log('A1: Both resolved, no bye');
  var b = toObj([
    M(1, 'Bob', 'Carol', { wTo: 2 }),
    M(2, 'Alice', null),
  ]);
  var bMap = buildBlockerMap(b);
  assert(bMap.blockedPlayers['alice'] === 2, 'alice blocked at match 2');
  assert(bMap.blockedMatches[2].length === 1, 'one blocker for match 2');
  assert(bMap.blockedMatches[2][0].num === 1, 'blocker is match 1');
  assert(bMap.blockedMatches[2][0].wl === 'W', 'wl is W');

  var bl = getBlockersForPlayer(pd('Alice'), bMap, null);
  assert(bl.length === 1, 'alice has 1 blocker');
  assert(bl[0].p1.name === 'Bob', 'blocker p1 is Bob');
  assert(bl[0].p2.name === 'Carol', 'blocker p2 is Carol');
  assert(bl[0].children.length === 0, 'no children');

  var np = getNextPlaysInfo(b, 1);
  assert(np.hasWinner, 'match 1 has winner destination');
  assert(np.winner.name === 'Alice', 'winner plays Alice');
})();

// ═══════════════════════════════════════════════
// A2: Both resolved, with bye
// M1(Bob,Carol) →W→ BYE(M99) →W→ M2(Alice,??)
// ═══════════════════════════════════════════════
(function() {
  console.log('A2: Both resolved, with bye');
  var b = toObj([
    M(1, 'Bob', 'Carol', { wTo: 99 }),
    M(99, null, null, { bye: true, wTo: 2 }),
    M(2, 'Alice', null),
  ]);
  var bMap = buildBlockerMap(b);
  assert(bMap.blockedPlayers['alice'] === 2, 'alice blocked at match 2');
  assert(bMap.blockedMatches[2].length === 1, 'one blocker');
  assert(bMap.blockedMatches[2][0].num === 1, 'blocker is match 1 (skipped bye)');

  var np = getNextPlaysInfo(b, 1);
  assert(np.winner.name === 'Alice', 'winner plays Alice (bye skipped)');
})();

// ═══════════════════════════════════════════════
// B1: One TBD → 2 real, no bye
// M2(Dan,Eve) →W→ M1(Bob,TBD) →W→ M3(Alice,??)
// ═══════════════════════════════════════════════
(function() {
  console.log('B1: One TBD -> 2 real, no bye');
  var b = toObj([
    M(2, 'Dan', 'Eve', { wTo: 1 }),
    M(1, 'Bob', null, { wTo: 3 }),
    M(3, 'Alice', null),
  ]);
  var bMap = buildBlockerMap(b);
  var bl = getBlockersForPlayer(pd('Alice'), bMap, null);
  assert(bl.length === 1, 'alice has 1 blocker');
  assert(bl[0].p1.name === 'Bob', 'blocker is Bob vs TBD');
  assert(bl[0].p2 === null, 'blocker p2 is TBD');
  assert(bl[0].wl === 'W', 'wl is W');
  assert(bl[0].children.length === 1, 'one child');
  assert(bl[0].children[0].p1.name === 'Dan', 'child p1 is Dan');
  assert(bl[0].children[0].p2.name === 'Eve', 'child p2 is Eve');
  assert(bl[0].children[0].wl === 'W', 'child wl is W');
})();

// ═══════════════════════════════════════════════
// B2: One TBD → 2 real, with bye on blocker→Alice
// M2(Dan,Eve) →W→ M1(Bob,TBD) →W→ BYE(M99) →W→ M3(Alice,??)
// ═══════════════════════════════════════════════
(function() {
  console.log('B2: One TBD -> 2 real, bye on blocker->Alice');
  var b = toObj([
    M(2, 'Dan', 'Eve', { wTo: 1 }),
    M(1, 'Bob', null, { wTo: 99 }),
    M(99, null, null, { bye: true, wTo: 3 }),
    M(3, 'Alice', null),
  ]);
  var bMap = buildBlockerMap(b);
  var bl = getBlockersForPlayer(pd('Alice'), bMap, null);
  assert(bl.length === 1, 'alice has 1 blocker');
  assert(bl[0].p1.name === 'Bob', 'blocker is Bob vs TBD');
  assert(bl[0].children.length === 1, 'one child');
  assert(bl[0].children[0].p1.name === 'Dan', 'child is Dan vs Eve');
})();

// ═══════════════════════════════════════════════
// C1: One TBD → 1 real + 1 TBD, no bye
// M2(Dan,TBD) →W→ M1(Bob,TBD) →W→ M3(Alice,??)
// ═══════════════════════════════════════════════
(function() {
  console.log('C1: One TBD -> 1 real + 1 TBD, no bye');
  var b = toObj([
    M(2, 'Dan', null, { wTo: 1 }),
    M(1, 'Bob', null, { wTo: 3 }),
    M(3, 'Alice', null),
  ]);
  var bMap = buildBlockerMap(b);
  var bl = getBlockersForPlayer(pd('Alice'), bMap, null);
  assert(bl.length === 1, 'alice has 1 blocker');
  assert(bl[0].p1.name === 'Bob', 'blocker p1 is Bob');
  assert(bl[0].children.length === 1, 'one child');
  assert(bl[0].children[0].p1.name === 'Dan', 'child p1 is Dan');
  assert(bl[0].children[0].p2 === null, 'child p2 is TBD');
})();

// ═══════════════════════════════════════════════
// C2: One TBD → 1 real + 1 TBD, bye on child→blocker
// M2(Dan,TBD) →W→ BYE(M99) →W→ M1(Bob,TBD) →W→ M3(Alice,??)
// ═══════════════════════════════════════════════
(function() {
  console.log('C2: One TBD -> 1 real + 1 TBD, bye on child->blocker');
  var b = toObj([
    M(2, 'Dan', null, { wTo: 99 }),
    M(99, null, null, { bye: true, wTo: 1 }),
    M(1, 'Bob', null, { wTo: 3 }),
    M(3, 'Alice', null),
  ]);
  var bMap = buildBlockerMap(b);
  var bl = getBlockersForPlayer(pd('Alice'), bMap, null);
  assert(bl.length === 1, 'alice has 1 blocker');
  assert(bl[0].children.length === 1, 'one child (bye skipped)');
  assert(bl[0].children[0].p1.name === 'Dan', 'child is Dan vs TBD');
})();

// ═══════════════════════════════════════════════
// D1: One TBD → TBD vs TBD, no bye
// M2(TBD,TBD) →W→ M1(Bob,TBD) →W→ M3(Alice,??)
// ═══════════════════════════════════════════════
(function() {
  console.log('D1: One TBD -> TBD vs TBD, no bye');
  var b = toObj([
    M(2, null, null, { wTo: 1 }),
    M(1, 'Bob', null, { wTo: 3 }),
    M(3, 'Alice', null),
  ]);
  var bMap = buildBlockerMap(b);
  var bl = getBlockersForPlayer(pd('Alice'), bMap, null);
  assert(bl.length === 1, 'alice has 1 blocker');
  assert(bl[0].children.length === 1, 'one child');
  assert(bl[0].children[0].p1 === null, 'child p1 is TBD');
  assert(bl[0].children[0].p2 === null, 'child p2 is TBD');
})();

// ═══════════════════════════════════════════════
// D2: One TBD → TBD vs TBD, bye on blocker→Alice
// M2(TBD,TBD) →W→ M1(Bob,TBD) →W→ BYE(M99) →W→ M3(Alice,??)
// ═══════════════════════════════════════════════
(function() {
  console.log('D2: One TBD -> TBD vs TBD, bye on blocker->Alice');
  var b = toObj([
    M(2, null, null, { wTo: 1 }),
    M(1, 'Bob', null, { wTo: 99 }),
    M(99, null, null, { bye: true, wTo: 3 }),
    M(3, 'Alice', null),
  ]);
  var bMap = buildBlockerMap(b);
  var bl = getBlockersForPlayer(pd('Alice'), bMap, null);
  assert(bl.length === 1, 'alice has 1 blocker');
  assert(bl[0].children.length === 1, 'one child');
  assert(bl[0].children[0].p1 === null, 'child is TBD vs TBD');
})();

// ═══════════════════════════════════════════════
// E1: Two TBDs → resolve both, no bye
// M2(Dan,Eve) →W→ M1(TBD,TBD) →W→ M3(Alice,??)
// M4(Frank,Grace) →L→ M1
// ═══════════════════════════════════════════════
(function() {
  console.log('E1: Two TBDs -> resolve both, no bye');
  var b = toObj([
    M(2, 'Dan', 'Eve', { wTo: 1 }),
    M(4, 'Frank', 'Grace', { lTo: 1 }),
    M(1, null, null, { wTo: 3 }),
    M(3, 'Alice', null),
  ]);
  var bMap = buildBlockerMap(b);
  var bl = getBlockersForPlayer(pd('Alice'), bMap, null);
  assert(bl.length === 1, 'alice has 1 blocker');
  assert(bl[0].p1 === null && bl[0].p2 === null, 'blocker is TBD vs TBD');
  assert(bl[0].wl === 'W', 'wl is W');
  assert(bl[0].children.length === 2, 'two children');

  var wChild = bl[0].children.filter(function(c) { return c.wl === 'W'; })[0];
  var lChild = bl[0].children.filter(function(c) { return c.wl === 'L'; })[0];
  assert(wChild && wChild.p1.name === 'Dan', 'W child is Dan vs Eve');
  assert(lChild && lChild.p1.name === 'Frank', 'L child is Frank vs Grace');

  var np = getNextPlaysInfo(b, 1);
  assert(np.winner.name === 'Alice', 'winner of TBD vs TBD plays Alice');
})();

// ═══════════════════════════════════════════════
// E2: Two TBDs → resolve both, bye on blocker→Alice
// M2(Dan,Eve) →W→ M1(TBD,TBD) →W→ BYE(M99) →W→ M3(Alice,??)
// M4(Frank,Grace) →L→ M1
// ═══════════════════════════════════════════════
(function() {
  console.log('E2: Two TBDs -> resolve both, bye on blocker->Alice');
  var b = toObj([
    M(2, 'Dan', 'Eve', { wTo: 1 }),
    M(4, 'Frank', 'Grace', { lTo: 1 }),
    M(1, null, null, { wTo: 99 }),
    M(99, null, null, { bye: true, wTo: 3 }),
    M(3, 'Alice', null),
  ]);
  var bMap = buildBlockerMap(b);
  var bl = getBlockersForPlayer(pd('Alice'), bMap, null);
  assert(bl.length === 1, 'alice has 1 blocker');
  assert(bl[0].p1 === null && bl[0].p2 === null, 'blocker is TBD vs TBD');
  assert(bl[0].children.length === 2, 'two children');

  var np = getNextPlaysInfo(b, 1);
  assert(np.winner.name === 'Alice', 'winner plays Alice (bye skipped)');
})();

// ═══════════════════════════════════════════════
// Guard tests
// ═══════════════════════════════════════════════
(function() {
  console.log('Guards: IN_PROGRESS / COMPLETED / no matches');
  var b = toObj([
    M(1, 'Bob', 'Carol', { wTo: 2 }),
    M(2, 'Alice', null),
  ]);
  var bMap = buildBlockerMap(b);

  // Player currently playing — no blockers
  var pdLive = { player: { name: 'Alice' }, matches: [{ status: 'IN_PROGRESS', num: 2 }] };
  assert(getBlockersForPlayer(pdLive, bMap, null).length === 0, 'no blockers when IN_PROGRESS');

  // Tournament completed — no blockers
  assert(getBlockersForPlayer(pd('Alice'), bMap, 'COMPLETED').length === 0, 'no blockers when COMPLETED');

  // No matches — no blockers
  var pdEmpty = { player: { name: 'Alice' }, matches: [] };
  assert(getBlockersForPlayer(pdEmpty, bMap, null).length === 0, 'no blockers when no matches');
})();

// ═══════════════════════════════════════════════
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  if (typeof process !== 'undefined') process.exit(1);
  else if (typeof quit === 'function') quit(1);
}
