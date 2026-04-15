// Bracket algorithm: forward-propagation blocker and next-plays logic.
// Extracted from index.html to enable unit testing.

// Follow forward through byes to find the real destination match.
function followTo(bracketByNum, destNum) {
  for (var step = 0; step < 10; step++) {
    if (!destNum) return null;
    var dest = bracketByNum[destNum];
    if (!dest) return null;
    if (!dest.is_bye) return dest;
    destNum = dest.winnerTo;
  }
  return null;
}

// Single-pass forward propagation: for each unresolved match, follow
// winnerTo/loserTo one hop to build two tables.
function buildBlockerMap(bracketByNum) {
  var blockedMatches = {};  // destMatchNum → [feeder entries]
  var blockedPlayers = {};  // playerName → pendingMatchNum
  for (var k in bracketByNum) {
    var S = bracketByNum[k];
    if (S.is_bye || S.p1Won || S.p2Won) continue;
    var paths = [[S.winnerTo, 'W'], [S.loserTo, 'L']];
    for (var pi = 0; pi < paths.length; pi++) {
      var D = followTo(bracketByNum, paths[pi][0]);
      if (!D || D.p1Won || D.p2Won) continue;
      if (!blockedMatches[D.num]) blockedMatches[D.num] = [];
      blockedMatches[D.num].push({
        num: S.num, identifier: S.identifier,
        p1: S.p1, p2: S.p2, s1: S.s1, s2: S.s2,
        status: S.status, wl: paths[pi][1]
      });
      var wp = (D.p1 && !D.p2) ? D.p1 : (!D.p1 && D.p2) ? D.p2 : null;
      if (wp) blockedPlayers[wp.name.toLowerCase()] = D.num;
    }
  }
  return { blockedMatches: blockedMatches, blockedPlayers: blockedPlayers };
}

function getBlockersForPlayer(pd, bMap, tournamentStatus) {
  if (!pd.matches.length) return [];
  if (tournamentStatus === 'COMPLETED') return [];
  var lastMatch = pd.matches[pd.matches.length - 1];
  if (lastMatch.status === 'IN_PROGRESS') return [];
  var pendingNum = bMap.blockedPlayers[pd.player.name.toLowerCase()];
  if (!pendingNum) return [];
  var level1 = (bMap.blockedMatches[pendingNum] || []).slice();
  for (var i = 0; i < level1.length; i++) {
    level1[i] = Object.assign({}, level1[i], { children: bMap.blockedMatches[level1[i].num] || [] });
  }
  return level1;
}

// For an unresolved match, look up where the winner/loser go next
// and who (if anyone) is already waiting there.
function getNextPlaysInfo(bracketByNum, matchNum) {
  var match = bracketByNum[matchNum];
  if (!match || match.p1Won || match.p2Won) return null;
  var info = {};
  var wDest = followTo(bracketByNum, match.winnerTo);
  if (wDest && !(wDest.p1 && wDest.p2)) {
    info.winner = wDest.p1 || wDest.p2 || null;
    info.hasWinner = true;
  }
  var lDest = followTo(bracketByNum, match.loserTo);
  if (lDest && !(lDest.p1 && lDest.p2)) {
    info.loser = lDest.p1 || lDest.p2 || null;
    info.hasLoser = true;
  }
  return (info.hasWinner || info.hasLoser) ? info : null;
}

// Node.js export (no-op in browser)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { followTo, buildBlockerMap, getBlockersForPlayer, getNextPlaysInfo };
}
