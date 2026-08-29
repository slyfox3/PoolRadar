// Bracket algorithm: the draw indexed both ways, and the blocker and
// next-plays logic that reads it.
// Extracted from index.html to enable unit testing.

// Follow forward through byes to find the real destination match number.
//
// Cycle-safe by remembering where it has been rather than by counting steps.
// The step cap this replaces was a cycle guard wearing a depth limit's clothes:
// it could not tell a draw with an eleventh consecutive bye from one that loops
// back on itself, and answered "nowhere" to both. A hand-edited draw can
// produce the loop; a large enough field can produce the depth.
function followNum(byNum, destNum) {
  var seen = {}, n = destNum;
  while (n) {
    if (seen[n]) return null;
    seen[n] = true;
    var d = byNum[n];
    if (!d) return null;
    if (!d.is_bye) return d.num;
    n = d.winnerTo;
  }
  return null;
}

// The row rather than the number, which is what the blocker and next-plays code
// wants — it reads the destination's players straight off it.
function followTo(bracketByNum, destNum) {
  var n = followNum(bracketByNum, destNum);
  return n == null ? null : bracketByNum[n];
}

// One pass over the draw, indexed both ways.
//
// Everything downstream — what is holding a match up, where a winner goes next,
// which matches a player passed through, which players a country fielded — is a
// lookup in one of these tables rather than another sweep of the rows. That is
// the point: those questions are asked once per card, once per search keystroke
// and twice per render, and each one used to cost a scan.
//
// Takes the match-number-keyed object index.html holds, or a plain array of the
// same rows. Either way the rows are sorted by match number before anything is
// indexed, so the order feeders come back in is a property of the draw rather
// than of whichever source happened to deliver it. That matters more than it
// looks: WNT hands its matches over group by group, which is not ascending, and
// the "By Match #" view prints whichever feeder comes back first. Today that
// order is right only because a for..in over integer-like keys happens to
// ascend — this makes it something the code states rather than inherits.
function buildBracketIndex(src) {
  var rows = [], k, i;
  if (Object.prototype.toString.call(src) === '[object Array]') {
    for (i = 0; i < src.length; i++) rows.push(src[i]);
  } else {
    for (k in src) rows.push(src[k]);
  }
  rows.sort(function(a, b) { return a.num - b.num; });

  var byNum = {};
  for (i = 0; i < rows.length; i++) byNum[rows[i].num] = rows[i];

  // followNum, memoised across the whole chain rather than just its entry
  // point: every bye on the way to a real match resolves to that same match, so
  // one walk answers for all of them. A real match memoises to itself, which is
  // what makes a second lookup free rather than merely cheap.
  var hopped = {};
  function hop(n) {
    if (!n) return null;
    if (n in hopped) return hopped[n];
    var chain = [], seen = {}, at = n, end = null;
    while (at && !seen[at]) {
      seen[at] = true;
      chain.push(at);
      var d = byNum[at];
      if (!d) break;
      if (!d.is_bye) { end = d.num; break; }
      at = d.winnerTo;
    }
    for (var c = 0; c < chain.length; c++) hopped[chain[c]] = end;
    return end;
  }

  // fwd: a match to where its winner and its loser land, byes already hopped.
  // rev: a match to what feeds it, ascending, whether or not either end has
  // been played.
  //
  // Deliberately unpruned. The narrower question the blockers table asks — what
  // is still holding this up — is two filters on the way out, not a second
  // table. Pruning here would make the shape depend on who has won, which is
  // exactly what changes under the sixty-second refresh, and an index that has
  // to be rebuilt whenever a result lands is no index at all.
  var fwd = {}, rev = {};
  for (i = 0; i < rows.length; i++) {
    var S = rows[i];
    if (S.is_bye) continue;
    var edges = [[S.winnerTo, 'W', S.winnerToPos], [S.loserTo, 'L', S.loserToPos]];
    var out = { w: null, l: null };
    for (var e = 0; e < 2; e++) {
      var raw = edges[e][0], d = hop(raw);
      if (e === 0) out.w = d; else out.l = d;
      if (d == null) continue;
      if (!rev[d]) rev[d] = [];
      // pos is dropped when the edge hopped a bye — the slot it named belonged
      // to the bye, not to the match the edge now lands on.
      rev[d].push({ num: S.num, kind: edges[e][1],
                    pos: d === raw ? (edges[e][2] || null) : null });
    }
    fwd[S.num] = out;
  }

  // Every appearance of every player, in bracket order, with the side they were
  // on and how it went. A run is this list; nothing has to sweep the draw to
  // find one. A bye is an entry in nobody's list — it is not a match anyone
  // played — but the player is still indexed, because a player whose only row
  // is a bye is still in the draw and still has a card.
  //
  // Null-prototype maps: these are keyed by strings off the wire, and a player
  // called "constructor" should not find one.
  var players = Object.create(null);
  for (i = 0; i < rows.length; i++) {
    var r = rows[i], sides = [r.p1, r.p2];
    for (var s = 0; s < 2; s++) {
      var c = sides[s];
      if (!c || !c.name) continue;
      var key = c.name.toLowerCase();
      var p = players[key];
      if (!p) {
        // country is absent on the DigitalPool side, which simply means no
        // flags and no country rows there.
        p = players[key] = { name: c.name, country: c.country || null,
                             countryName: c.countryName || null, at: [] };
      }
      if (r.is_bye) continue;
      p.at.push({
        num: r.num, round: r.round == null ? null : r.round, side: s + 1,
        won: s === 0 ? !!r.p1Won : !!r.p2Won,
        decided: !!(r.p1Won || r.p2Won),
      });
    }
  }

  // A country is a set of names, which is the only thing a selection ever needs
  // of it. Resolving it here rather than testing a code against every
  // challenger is also what keeps the two sources apart: DigitalPool carries no
  // country at all, so its players simply never land in one.
  var countries = Object.create(null);
  for (key in players) {
    var pl = players[key];
    if (!pl.country) continue;
    var co = countries[pl.country];
    if (!co) {
      co = countries[pl.country] = { code: pl.country,
                                     name: pl.countryName || pl.country, names: [] };
    }
    co.names.push(pl.name);
  }

  return { rows: rows, byNum: byNum, hop: hop, fwd: fwd, rev: rev,
           players: players, countries: countries };
}

// What is still holding each unplayed match up, and who is sitting waiting in
// one.
//
// A view of the index rather than a walk of its own. The two skips are the
// whole of the difference: a feeder that already has a winner has delivered its
// player and is holding nothing up, and a destination that has been played is
// past caring.
function buildBlockerMap(bracketByNum, idx) {
  idx = idx || buildBracketIndex(bracketByNum);
  var blockedMatches = {};  // destMatchNum → [feeder entries]
  var blockedPlayers = {};  // playerName → pendingMatchNum
  for (var i = 0; i < idx.rows.length; i++) {
    var S = idx.rows[i];
    if (S.is_bye || S.p1Won || S.p2Won) continue;
    var f = idx.fwd[S.num];
    var paths = [[f.w, 'W'], [f.l, 'L']];
    for (var pi = 0; pi < paths.length; pi++) {
      var dn = paths[pi][0];
      var D = dn == null ? null : idx.byNum[dn];
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
  if (tournamentStatus === 'COMPLETED') return [];
  if (pd.matches.length) {
    var lastMatch = pd.matches[pd.matches.length - 1];
    if (lastMatch.status === 'IN_PROGRESS') return [];
  } else if (!pd.byeMatchNum) {
    return [];
  }
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
//
// Pass the index and the two destinations are lookups; without it they are two
// walks, which is how the callers that have no index handy still work.
function getNextPlaysInfo(bracketByNum, matchNum, idx) {
  var match = bracketByNum[matchNum];
  if (!match || match.p1Won || match.p2Won) return null;
  var info = {};
  var f = idx && idx.fwd[matchNum];
  var wDest = f ? (f.w == null ? null : idx.byNum[f.w]) : followTo(bracketByNum, match.winnerTo);
  var lDest = f ? (f.l == null ? null : idx.byNum[f.l]) : followTo(bracketByNum, match.loserTo);
  // Double dip: in double-elim, the last match is always 2^n - 1.
  // If winnerTo points to that match, this is the grand final.
  // In double-elim, the LB final is the match before the grand final,
  // and its winner advances to the grand final.
  var lbFinal = bracketByNum[match.num - 1];
  if (wDest && match.p1 && match.p2 && wDest.num >= 3 &&
      (wDest.num & (wDest.num + 1)) === 0 &&
      lbFinal && lbFinal.winnerTo === match.num) {
    return { doubleDip: true };
  }
  if (wDest && !(wDest.p1 && wDest.p2)) {
    info.winner = wDest.p1 || wDest.p2 || null;
    if (!info.winner) info.winnerDest = wDest.num;
    info.hasWinner = true;
  }
  if (lDest && !(lDest.p1 && lDest.p2)) {
    info.loser = lDest.p1 || lDest.p2 || null;
    if (!info.loser) info.loserDest = lDest.num;
    info.hasLoser = true;
  }
  return (info.hasWinner || info.hasLoser) ? info : null;
}

// Node.js export (no-op in browser)
//
// Deliberately not an ES module. index.html and test_blockers.html load this
// with a plain <script src>, and test_blockers.js is run by handing both files
// to jsc, which shares one global scope between them; an `export` would break
// all three at once. graph.html reads the same globals from inside its module,
// which works because a classic script runs before any module does.
//
// One consequence worth knowing: a module that declares its own `const` of the
// same name shadows the global silently, with no error anywhere. Nothing here
// may be renamed to something graph.html already declares at its top level.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { followNum, followTo, buildBracketIndex, buildBlockerMap,
                     getBlockersForPlayer, getNextPlaysInfo };
}
