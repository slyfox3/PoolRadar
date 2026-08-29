// Terminal: /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc bracket-algo.js test_blockers.js
// Browser: open test_blockers.html
'use strict';
if (typeof console === 'undefined') {
  var console = { log: function(s) { print(s); }, error: function(s) { print(s); } };
}
if (typeof require === 'function') {
  var algo = require('./bracket-algo.js');
  var followTo = algo.followTo;
  var buildBracketIndex = algo.buildBracketIndex;
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
    // country rides along so the index's per-country rollup can be tested.
    // Left null everywhere else, which is what the DigitalPool side looks like.
    p1: p1 ? { name: p1, rating: null, country: opts.c1 || null } : null,
    p2: p2 ? { name: p2, rating: null, country: opts.c2 || null } : null,
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

// Same logic as in index.html — find the other feeder to a destination
function resolveFeeder(destNum, excludeNum, bMap) {
  var feeders = bMap.blockedMatches[destNum] || [];
  for (var i = 0; i < feeders.length; i++) {
    if (feeders[i].num !== excludeNum) return feeders[i];
  }
  return null;
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
// F1: Double dip — 8-player bracket (last match = 15 = 2^4-1)
// M14(Artem,Kalata) →W→ M15 (double dip)
// ═══════════════════════════════════════════════
(function() {
  console.log('F1: Double dip — 8-player bracket');
  var b = toObj([
    M(13, 'Jack', 'Eddie', { wTo: 14, status: 'COMPLETED', p1Won: true }),
    M(14, 'Artem', 'Kalata', { wTo: 15 }),
    M(15, null, null),
  ]);
  var np = getNextPlaysInfo(b, 14);
  assert(np && np.doubleDip === true, 'doubleDip when winnerTo is 2^n-1');
})();

// ═══════════════════════════════════════════════
// F2: Double dip — 32-player bracket (last match = 63 = 2^6-1)
// M62(Artem,Kalata) →W→ M63, →L→ null
// ═══════════════════════════════════════════════
(function() {
  console.log('F2: Double dip — 32-player bracket');
  var b = toObj([
    M(61, 'Artem', 'Jack', { wTo: 62, status: 'COMPLETED', p1Won: true }),
    M(62, 'Artem', 'Kalata', { wTo: 63 }),
    M(63, null, null),
  ]);
  var np = getNextPlaysInfo(b, 62);
  assert(np && np.doubleDip === true, 'doubleDip when winnerTo is 2^n-1');
})();

// ═══════════════════════════════════════════════
// F3: NOT a double dip — normal LR match with loserTo null
// M19(Alice,Bob) →W→ M21(empty), →L→ null
// ═══════════════════════════════════════════════
(function() {
  console.log('F3: Not a double dip — normal LR match');
  var b = toObj([
    M(19, 'Alice', 'Bob', { wTo: 21 }),
    M(21, null, null),
  ]);
  var np = getNextPlaysInfo(b, 19);
  assert(!np || !np.doubleDip, 'no doubleDip for non-2^n-1 destination');
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
// G1: Resolve TBD opponent — winner side match
// M10(Alice,Bob) →W→ M12(empty), →L→ M11(empty)
// M20(Carol,Dave) →W→ M12
// M30(Eve,Frank) →L→ M11
// ═══════════════════════════════════════════════
(function() {
  console.log('G1: Resolve TBD — if wins / if loses');
  var b = toObj([
    M(10, 'Alice', 'Bob', { wTo: 12, lTo: 11 }),
    M(20, 'Carol', 'Dave', { wTo: 12 }),
    M(30, 'Eve', 'Frank', { lTo: 11 }),
    M(12, null, null),
    M(11, null, null),
  ]);
  var bMap = buildBlockerMap(b);
  var np = getNextPlaysInfo(b, 10);

  // Winner dest is TBD — resolves to "W of Carol vs Dave"
  assert(np.hasWinner, 'has winner');
  assert(np.winner === null, 'winner is TBD (both slots empty)');
  assert(np.winnerDest === 12, 'winnerDest is match 12');
  var wOpp = resolveFeeder(np.winnerDest, 10, bMap);
  assert(wOpp && wOpp.num === 20, 'winner opponent feeder is match 20');
  assert(wOpp.wl === 'W', 'winner opponent wl is W');
  assert(wOpp.p1.name === 'Carol', 'winner opponent p1 is Carol');
  assert(wOpp.p2.name === 'Dave', 'winner opponent p2 is Dave');

  // Loser dest is TBD — resolves to "L of Eve vs Frank"
  assert(np.hasLoser, 'has loser');
  assert(np.loser === null, 'loser is TBD');
  assert(np.loserDest === 11, 'loserDest is match 11');
  var lOpp = resolveFeeder(np.loserDest, 10, bMap);
  assert(lOpp && lOpp.num === 30, 'loser opponent feeder is match 30');
  assert(lOpp.wl === 'L', 'loser opponent wl is L');
  assert(lOpp.p1.name === 'Eve', 'loser opponent p1 is Eve');
  assert(lOpp.p2.name === 'Frank', 'loser opponent p2 is Frank');
})();

// ═══════════════════════════════════════════════
// G2: Resolve TBD — one known, one TBD
// M10(Alice,Bob) →W→ M12(Charlie,??)
// M20(Carol,Dave) →L→ M11(empty)
// M10 →L→ M11
// ═══════════════════════════════════════════════
(function() {
  console.log('G2: Resolve TBD — one known, one needs resolving');
  var b = toObj([
    M(10, 'Alice', 'Bob', { wTo: 12, lTo: 11 }),
    M(20, 'Carol', 'Dave', { lTo: 11 }),
    M(12, 'Charlie', null),
    M(11, null, null),
  ]);
  var bMap = buildBlockerMap(b);
  var np = getNextPlaysInfo(b, 10);

  // Winner plays Charlie (already seated)
  assert(np.winner && np.winner.name === 'Charlie', 'winner plays Charlie');
  assert(!np.winnerDest, 'no winnerDest when opponent is known');

  // Loser is TBD — resolves to "L of Carol vs Dave"
  assert(np.loser === null, 'loser opponent is TBD');
  var lOpp = resolveFeeder(np.loserDest, 10, bMap);
  assert(lOpp && lOpp.p1.name === 'Carol', 'loser opponent resolves to Carol vs Dave');
  assert(lOpp.wl === 'L', 'loser opponent wl is L');
})();

// ═══════════════════════════════════════════════
// G3: No feeder to resolve — destination empty, no other match feeds in
// ═══════════════════════════════════════════════
(function() {
  console.log('G3: No feeder to resolve');
  var b = toObj([
    M(10, 'Alice', 'Bob', { wTo: 12 }),
    M(12, null, null),
  ]);
  var bMap = buildBlockerMap(b);
  var np = getNextPlaysInfo(b, 10);
  assert(np.winnerDest === 12, 'winnerDest set');
  var opp = resolveFeeder(np.winnerDest, 10, bMap);
  assert(opp === null, 'no feeder to resolve — stays TBD');
})();

// ═══════════════════════════════════════════════
// H1: Forward adjacency — a bye is hopped, not landed on
// M1(Bob,Carol) →W→ BYE(M99) →W→ M2 , →L→ M3
// ═══════════════════════════════════════════════
(function() {
  console.log('H1: Forward adjacency hops byes');
  var idx = buildBracketIndex(toObj([
    M(1, 'Bob', 'Carol', { wTo: 99, lTo: 3 }),
    M(99, null, null, { bye: true, wTo: 2 }),
    M(2, 'Alice', null),
    M(3, null, null),
  ]));
  assert(idx.fwd[1].w === 2, 'the winner lands on 2, not on the bye');
  assert(idx.fwd[1].l === 3, 'the loser lands on 3');
  assert(idx.fwd[2].w === null, 'nowhere to go reads as null, not undefined');
  assert(idx.hop(99) === 2, 'the bye itself resolves to what it feeds');
  assert(idx.hop(0) === null && idx.hop(null) === null, '0 and null both mean nowhere');
  assert(!idx.fwd[99], 'a bye is not a match and has no outgoing entry');
  assert(!idx.rev[99], 'and nothing is recorded as feeding one');
})();

// ═══════════════════════════════════════════════
// H2: Reverse adjacency keeps decided feeders; blockers drops them
// Rows handed over out of order on purpose.
// ═══════════════════════════════════════════════
(function() {
  console.log('H2: Reverse adjacency, decided feeders included');
  var list = [
    M(30, 'Eve', 'Frank', { lTo: 12 }),
    M(10, 'Alice', 'Bob', { wTo: 12 }),
    M(20, 'Carol', 'Dave', { wTo: 12, status: 'COMPLETED', p1Won: true }),
    M(12, 'Carol', null),
  ];
  var idx = buildBracketIndex(list);
  var into = idx.rev[12] || [];
  assert(into.length === 3, 'all three feeders are indexed, played or not');
  assert(into.map(function(f) { return f.num; }).join(',') === '10,20,30',
    'and they ascend by match number whatever order the rows arrived in');
  assert(into[2].kind === 'L', 'the drop-in is marked L, the two promotions W');

  var bMap = buildBlockerMap(toObj(list));
  assert(bMap.blockedMatches[12].length === 2, 'the played feeder is not a blocker');
  assert(bMap.blockedPlayers['carol'] === 12, 'Carol is the one sitting waiting');
})();

// ═══════════════════════════════════════════════
// H3: A bye chain that loops back on itself terminates
// ═══════════════════════════════════════════════
(function() {
  console.log('H3: A cycle of byes terminates');
  var idx = buildBracketIndex(toObj([
    M(1, 'Bob', 'Carol', { wTo: 98 }),
    M(98, null, null, { bye: true, wTo: 99 }),
    M(99, null, null, { bye: true, wTo: 98 }),
  ]));
  assert(idx.hop(98) === null, 'a loop resolves to nowhere rather than spinning');
  assert(idx.hop(98) === null, 'and the memo gives the same answer, not a re-walk');
  assert(idx.fwd[1].w === null, 'so the edge into it is dropped');
  assert(!idx.rev[98] && !idx.rev[99], 'and nothing is recorded as feeding a bye');
})();

// ═══════════════════════════════════════════════
// H4: A bye chain deeper than the old ten-step cap
// ═══════════════════════════════════════════════
(function() {
  console.log('H4: Twelve byes in a row still resolve');
  var list = [M(1, 'Bob', 'Carol', { wTo: 101 })];
  for (var i = 101; i <= 112; i++) list.push(M(i, null, null, { bye: true, wTo: i + 1 }));
  list.push(M(113, 'Alice', null));
  var idx = buildBracketIndex(toObj(list));
  assert(idx.fwd[1].w === 113, 'the seen-set walk goes as deep as the draw does');
  assert(idx.hop(107) === 113, 'and every bye on the way memoises to the same answer');
})();

// ═══════════════════════════════════════════════
// H5: A player's run reads straight off the index
// Alice: beats Bob in 1, loses to Dave in 3, waits in 6
// ═══════════════════════════════════════════════
(function() {
  console.log('H5: A player run is a list, not a sweep');
  var idx = buildBracketIndex(toObj([
    M(1, 'Alice', 'Bob',  { wTo: 3, lTo: 4, status: 'COMPLETED', p1Won: true }),
    M(2, 'Carol', 'Dave', { wTo: 3, status: 'COMPLETED', p2Won: true }),
    M(3, 'Alice', 'Dave', { wTo: 5, lTo: 6, status: 'COMPLETED', p2Won: true }),
    M(6, 'Alice', null),
  ]));
  var a = idx.players['alice'];
  assert(a && a.at.length === 3, 'three appearances');
  assert(a.at.map(function(x) { return x.num; }).join(',') === '1,3,6', 'in match order');
  assert(a.at[0].side === 1 && a.at[0].won === true, 'won reads from the side she was on');
  assert(a.at[1].won === false, 'and the loss is a loss whichever side it was');
  assert(a.at[2].decided === false, 'the match she is waiting in is undecided');
  assert(idx.fwd[a.at[0].num].w === 3, 'the win carries her to 3');
  assert(idx.fwd[a.at[1].num].l === 6, 'the loss drops her to 6');
  assert(idx.players['dave'].at.length === 2, 'her opponent is indexed the same way');
})();

// ═══════════════════════════════════════════════
// H6: Two of one delegation drawn against each other
// ═══════════════════════════════════════════════
(function() {
  console.log('H6: Two selected players meet');
  var idx = buildBracketIndex(toObj([
    M(1, 'Ko Pin Yi', 'Chang Jung Lin', { wTo: 2, lTo: 3, c1: 'tw', c2: 'tw',
                                          status: 'COMPLETED', p1Won: true }),
    M(2, null, null),
    M(3, null, null),
  ]));
  var w = idx.players['ko pin yi'].at[0], l = idx.players['chang jung lin'].at[0];
  assert(w.num === l.num, 'one match, reached once from each side');
  assert(w.won === true && l.won === false, 'so it answers for both of them');
  assert(idx.fwd[w.num].w === 2 && idx.fwd[l.num].l === 3,
    'and sends one run on up and one down');
  assert(idx.countries['tw'].names.length === 2, 'both sit in the same delegation');
})();

// ═══════════════════════════════════════════════
// H7: A country is a set of names
// ═══════════════════════════════════════════════
(function() {
  console.log('H7: Country rollup');
  var idx = buildBracketIndex(toObj([
    M(1, 'Alice', 'Bob',  { c1: 'us', c2: 'gb' }),
    M(2, 'Carol', 'Dave', { c1: 'us' }),
  ]));
  assert(idx.countries['us'].names.length === 2, 'two Americans');
  assert(idx.countries['gb'].names.join(',') === 'Bob', 'one Briton');
  assert(Object.keys(idx.countries).length === 2,
    'Dave has no country, which is not a country');
})();

// ═══════════════════════════════════════════════
// H8: A group stage — no destinations anywhere
// ═══════════════════════════════════════════════
(function() {
  console.log('H8: A group stage has no edges at all');
  var b = toObj([
    M(1, 'Alice', 'Bob',  { status: 'COMPLETED', p1Won: true }),
    M(2, 'Carol', 'Dave', { status: 'COMPLETED', p2Won: true }),
    M(3, 'Alice', 'Carol'),
  ]);
  var idx = buildBracketIndex(b);
  assert(idx.fwd[1].w === null && idx.fwd[1].l === null, 'nothing leads anywhere');
  assert(Object.keys(idx.rev).length === 0, 'and nothing feeds anything');
  assert(idx.players['alice'].at.length === 2, 'the players are indexed all the same');
  var bMap = buildBlockerMap(b);
  assert(Object.keys(bMap.blockedMatches).length === 0, 'so nobody is blocked');
  assert(Object.keys(bMap.blockedPlayers).length === 0, 'and nobody is waiting');
})();

// ═══════════════════════════════════════════════
// H9: Single elimination — a loss ends the run
// ═══════════════════════════════════════════════
(function() {
  console.log('H9: Single elimination');
  var b = toObj([
    M(1, 'Alice', 'Bob',  { wTo: 3, status: 'COMPLETED', p1Won: true }),
    M(2, 'Carol', 'Dave', { wTo: 3, status: 'COMPLETED', p1Won: true }),
    M(3, 'Alice', 'Carol'),
  ]);
  var idx = buildBracketIndex(b);
  assert(idx.fwd[1].l === null, 'no losers side to drop to');
  assert(idx.rev[3].length === 2, 'both halves feed the final');
  assert(idx.rev[3][0].kind === 'W' && idx.rev[3][1].kind === 'W', 'both by winning');
  assert(idx.players['bob'].at[0].won === false && idx.players['bob'].at.length === 1,
    'Bob played once and is done');
  var bMap = buildBlockerMap(b);
  assert(!bMap.blockedMatches[3], 'both feeders are decided, so the final waits on nothing');
})();

// ═══════════════════════════════════════════════
// H10: Blocker entries keep their exact shape
// The renderer reads these eight fields off the feeder and no others.
// ═══════════════════════════════════════════════
(function() {
  console.log('H10: Blocker entry shape');
  var b = toObj([
    M(1, 'Bob', 'Carol', { id: 'W3-1', s1: 2, s2: 3, status: 'IN_PROGRESS', wTo: 2 }),
    M(2, 'Alice', null),
  ]);
  var e = buildBlockerMap(b).blockedMatches[2][0];
  assert(Object.keys(e).sort().join(',') === 'identifier,num,p1,p2,s1,s2,status,wl',
    'exactly the eight fields blockerPlayerLabel and fmTbdCell read');
  assert(e.identifier === 'W3-1' && e.s1 === 2 && e.s2 === 3 && e.status === 'IN_PROGRESS',
    'copied off the feeder, not off the destination');
  assert(e.p1 !== b[2].p1, 'and off the feeder, so a live score belongs to the right match');
})();

// ═══════════════════════════════════════════════
// H11: Feeder order is a property of the draw
// fmTbdCell prints the first feeder it finds, so the order this comes back in
// is what the page shows. Rows out of order on purpose.
// ═══════════════════════════════════════════════
(function() {
  console.log('H11: Feeder order is ascending by match number');
  var list = [
    M(30, 'Eve', 'Frank', { lTo: 11 }),
    M(10, 'Alice', 'Bob', { lTo: 11 }),
    M(11, null, null),
  ];
  var idx = buildBracketIndex(list);
  assert(idx.rev[11].map(function(f) { return f.num; }).join(',') === '10,30',
    'ascending, however the rows were handed over');
  var bMap = buildBlockerMap(toObj(list));
  assert(bMap.blockedMatches[11][0].num === 10, 'and the blocker list agrees');
  assert(resolveFeeder(11, null, bMap).num === 10, 'so the TBD cell names 10, every time');
})();

// ═══════════════════════════════════════════════
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  if (typeof process !== 'undefined') process.exit(1);
  else if (typeof quit === 'function') quit(1);
}
