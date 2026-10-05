// Bracket Beast adapter. Converts its public bracket response to PoolRadar's
// canonical { matches, tournament, bracketByNum } contract.
(function(root) {
  'use strict';

  var TERMINAL = { WinnerPlayer1: 1, WinnerPlayer2: 1, ForfeitPlayer1: 1,
                   ForfeitPlayer2: 1, Bye: 1 };

  function statusOf(m) {
    if (TERMINAL[m.matchStatus]) return 'COMPLETED';
    if (m.matchStatus === 'Playing' || m.matchStatus === 'ResultPending' ||
        m.matchStatus === 'Disputed') return 'IN_PROGRESS';
    return 'NOT_STARTED';
  }

  function player(id, name) {
    if (id == null || !name) return null;
    return { id: 'bracketbeast:' + id, name: name, playerId: null,
             rating: null, place: null, country: null, countryName: null };
  }

  function buildResult(payload, sourceUrl) {
    var data = payload.bracket || payload;
    var meta = payload.tournament || {};
    if (!data || Object.prototype.toString.call(data.rounds) !== '[object Array]') {
      throw new Error('Bracket Beast returned an unrecognised bracket response.');
    }

    var raw = [], byId = {};
    var lastWinnerRound = 0;
    for (var ri = 0; ri < data.rounds.length; ri++) {
      var round = data.rounds[ri];
      if (round.isWinnerRound && /^\d+$/.test(round.roundName || '')) {
        lastWinnerRound = Math.max(lastWinnerRound, Number(round.roundName));
      }
      for (var mi = 0; mi < round.matches.length; mi++) {
        var item = { match: round.matches[mi], round: round };
        raw.push(item);
        byId[item.match.id] = item;
      }
    }

    // consolationMatchId is where this match's loser lands. Winner movement
    // inside each side of the draw is implicit in round/playSequence: adjacent
    // games merge when the next round is half-sized, otherwise slots carry
    // straight across. feederMatchId covers the cross-bracket/final transfers.
    var winnerTo = {};
    var sides = { winner: [], loser: [] };
    for (var sr = 0; sr < data.rounds.length; sr++) {
      sides[data.rounds[sr].isWinnerRound ? 'winner' : 'loser'].push(data.rounds[sr]);
    }
    for (var side in sides) {
      sides[side].sort(function(a, b) { return a.roundSequence - b.roundSequence; });
      for (var si = 0; si + 1 < sides[side].length; si++) {
        var from = sides[side][si], to = sides[side][si + 1];
        var bySequence = {};
        for (var ti = 0; ti < to.matches.length; ti++) bySequence[to.matches[ti].playSequence] = to.matches[ti].id;
        var merges = to.matches.length < from.matches.length;
        for (var fi = 0; fi < from.matches.length; fi++) {
          var seq = from.matches[fi].playSequence;
          winnerTo[from.matches[fi].id] = bySequence[merges ? Math.ceil(seq / 2) : seq] || null;
        }
      }
    }
    for (var i = 0; i < raw.length; i++) {
      var dest = raw[i].match;
      if (dest.feederMatchId == null) continue;
      var source = byId[dest.feederMatchId];
      if (!source || source.match.consolationMatchId === dest.id) continue;
      winnerTo[dest.feederMatchId] = dest.id;
    }

    var matches = [], bracketByNum = {}, anyLive = false, allDone = raw.length > 0;
    for (var j = 0; j < raw.length; j++) {
      var m = raw[j].match, r = raw[j].round;
      var status = statusOf(m);
      var p1 = player(m.divisionPlayerId1, m.divisionPlayer1Name);
      var p2 = player(m.divisionPlayerId2, m.divisionPlayer2Name);
      var p1Won = m.matchStatus === 'WinnerPlayer1' || m.matchStatus === 'ForfeitPlayer2';
      var p2Won = m.matchStatus === 'WinnerPlayer2' || m.matchStatus === 'ForfeitPlayer1';
      var isBye = m.matchStatus === 'Bye';
      var finalNo = /^F(\d+)$/i.exec(r.roundName || '');
      var roundNumber = r.isWinnerRound
        ? (finalNo ? lastWinnerRound + Number(finalNo[1]) : (Number(r.roundName) || Number(r.roundSequence)))
        : -(Number(r.roundName.replace(/^L/i, '')) || r.roundSequence);
      bracketByNum[m.id] = {
        num: m.id, status: status, is_bye: isBye,
        identifier: m.matchName || r.roundName || null, round: roundNumber,
        p1: p1, p2: p2, s1: m.divisionPlayerId1Score, s2: m.divisionPlayerId2Score,
        p1Won: p1Won, p2Won: p2Won,
        winnerTo: winnerTo[m.id] || null, loserTo: m.consolationMatchId || null,
        scheduledTime: status === 'NOT_STARTED' ? m.startTime : null,
        startTime: status === 'NOT_STARTED' ? null : m.startTime,
        tableName: m.locationsDescription || null,
      };
      anyLive = anyLive || status === 'IN_PROGRESS';
      allDone = allDone && status === 'COMPLETED';

      // Empty Bye rows are routing nodes. Keep them in bracketByNum, but only
      // make a visible match/card when an actual participant owns the bye.
      if (isBye && !p1 && !p2) continue;
      if (!p1 || (!p2 && !isBye)) continue;
      matches.push({
        num: m.id, p1: p1 || p2, p2: isBye ? null : p2,
        s1: status === 'NOT_STARTED' ? null : m.divisionPlayerId1Score,
        s2: status === 'NOT_STARTED' ? null : m.divisionPlayerId2Score,
        p1Won: p1Won, p2Won: p2Won, status: status, videoUrl: null,
        tableName: m.locationsDescription || null,
        startTime: status === 'NOT_STARTED' ? null : m.startTime,
        scheduledTime: status === 'NOT_STARTED' ? m.startTime : null,
        updatedAt: m.endTime || null, round: roundNumber,
        identifier: m.matchName || r.roundName || null,
        isForfeit: /^Forfeit/.test(m.matchStatus || ''), isBye: isBye,
      });
    }

    var eventStatus = anyLive ? 'IN_PROGRESS' : (allDone ? 'COMPLETED' : 'NOT_STARTED');
    var sourceIds = String(sourceUrl || '').match(/\/tournament\/(\d+)\/divisions\/(\d+)\/brackets\/(\d+)/);
    var tournament = {
      name: data.tournamentName || meta.name || 'Bracket Beast tournament',
      date: meta.startDate || null, status: eventStatus,
      venue: meta.venueName ? { id: null, name: meta.venueName, city: null,
                               region: meta.venueRegion || null } : null,
      organizer: null, director: null,
      slug: sourceIds ? sourceIds.slice(1).join('/')
        : String(data.tournamentId) + '/' + String(data.divisionId) + '/' + String(data.divisionBracketId || ''),
      source: 'bracketbeast', dates: meta.startDate && meta.endDate ? meta.startDate + ' – ' + meta.endDate : null,
      sourceUrl: sourceUrl, divisionName: data.divisionName || null,
      bracketName: data.bracketName || null,
    };
    return { matches: matches, tournament: tournament, bracketByNum: bracketByNum };
  }

  root.bracketBeastBuildResult = buildResult;
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildResult: buildResult, statusOf: statusOf };
})(typeof globalThis !== 'undefined' ? globalThis : this);
