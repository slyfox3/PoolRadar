// Bracket Beast adapter. Converts its public bracket response to PoolRadar's
// canonical { matches, tournament, bracketByNum } contract.
(function(root) {
  'use strict';

  var TERMINAL = { WinnerPlayer1: 1, WinnerPlayer2: 1, ForfeitPlayer1: 1,
                   ForfeitPlayer2: 1, Bye: 1 };

  function statusCode(m) {
    var forfeit = /^Forfeit:\s*Player\s*([12])$/i.exec(m.matchStatus || '');
    return forfeit ? 'ForfeitPlayer' + forfeit[1] : m.matchStatus;
  }

  function statusOf(m) {
    if (TERMINAL[statusCode(m)]) return 'COMPLETED';
    if (m.matchStatus === 'Playing' || m.matchStatus === 'ResultPending' ||
        m.matchStatus === 'Disputed') return 'IN_PROGRESS';
    return 'NOT_STARTED';
  }

  function player(id, name) {
    if (id == null || !name) return null;
    return { id: 'bracketbeast:' + id, name: name, playerId: null,
             rating: null, place: null, country: null, countryName: null };
  }

  // Bracket Beast sends UTC timestamps without a zone suffix. Mark them as
  // UTC so Date parses the same instant in every browser timezone; retain any
  // explicit zone supplied by the API.
  function utcTime(value) {
    if (!value) return null;
    return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : value + 'Z';
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
      var status = statusOf(m), code = statusCode(m);
      var started = utcTime(m.startTime);
      var ended = utcTime(m.endTime);
      var p1 = player(m.divisionPlayerId1, m.divisionPlayer1Name);
      var p2 = player(m.divisionPlayerId2, m.divisionPlayer2Name);
      var p1Won = code === 'WinnerPlayer1' || code === 'ForfeitPlayer2';
      var p2Won = code === 'WinnerPlayer2' || code === 'ForfeitPlayer1';
      var isBye = m.matchStatus === 'Bye';
      var finalNo = /^F(\d+)$/i.exec(r.roundName || '');
      var identifier = m.matchName || r.roundName || null;
      // Match IDs and routing stay numeric; only the visible winner-side
      // label gains W. Finals keep their existing F1/F2 labels.
      if (r.isWinnerRound && !finalNo && identifier && !/^W/i.test(identifier)) identifier = 'W' + identifier;
      var roundNumber = r.isWinnerRound
        ? (finalNo ? lastWinnerRound + Number(finalNo[1]) : (Number(r.roundName) || Number(r.roundSequence)))
        : -(Number(r.roundName.replace(/^L/i, '')) || r.roundSequence);
      bracketByNum[m.id] = {
        num: m.id, status: status, is_bye: isBye,
        identifier: identifier, round: roundNumber,
        p1: p1, p2: p2, s1: m.divisionPlayerId1Score, s2: m.divisionPlayerId2Score,
        p1Won: p1Won, p2Won: p2Won,
        minimumPlace: r.minimumPlace, maximumPlace: r.maximumPlace,
        winnerTo: winnerTo[m.id] || null, loserTo: m.consolationMatchId || null,
        scheduledTime: status === 'NOT_STARTED' ? started : null,
        startTime: status === 'NOT_STARTED' ? null : started,
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
        startTime: status === 'NOT_STARTED' ? null : started,
        scheduledTime: status === 'NOT_STARTED' ? started : null,
        updatedAt: ended, round: roundNumber,
        identifier: identifier,
        isForfeit: /^Forfeit/.test(code || ''), isBye: isBye,
      });
    }

    // Operators can advance a participant before recording the feeder's
    // result. Their presence in the winner/loser destination settles that
    // feeder; use stable participant IDs rather than names or current scores.
    function advancedSide(source, destNum) {
      var dest = bracketByNum[destNum];
      if (!dest) return 0;
      var ids = [dest.p1 && dest.p1.id, dest.p2 && dest.p2.id];
      var first = ids.indexOf(source.p1.id) !== -1;
      var second = ids.indexOf(source.p2.id) !== -1;
      return first === second ? 0 : first ? 1 : 2;
    }
    Object.keys(bracketByNum).forEach(function(num) {
      var row = bracketByNum[num];
      if (row.is_bye || row.status === 'COMPLETED' || !row.p1 || !row.p2) return;
      var winner = advancedSide(row, row.winnerTo);
      var loser = advancedSide(row, row.loserTo);
      if (winner && loser && winner === loser) return; // conflicting destinations
      winner = winner || (loser ? 3 - loser : 0);
      if (!winner) return;
      row.status = 'COMPLETED';
      row.p1Won = winner === 1;
      row.p2Won = winner === 2;
      row.inferredWinnerFromAdvancement = true;
    });
    matches.forEach(function(match) {
      var row = bracketByNum[match.num];
      if (!row.inferredWinnerFromAdvancement) return;
      match.status = row.status;
      match.p1Won = row.p1Won;
      match.p2Won = row.p2Won;
      match.s1 = row.s1;
      match.s2 = row.s2;
      match.inferredWinnerFromAdvancement = true;
    });

    // Round placement bands describe the loser only when that loss ends the
    // run. Share the final place across every appearance of the participant,
    // which is the same player.place contract used by the DigitalPool view.
    var places = {}, winnerBracketChampion = null;
    raw.forEach(function(item) {
      var row = bracketByNum[item.match.id];
      if (item.round.isWinnerRound && Number(item.round.roundName) === lastWinnerRound &&
          row.status === 'COMPLETED' && (row.p1Won || row.p2Won)) {
        winnerBracketChampion = row.p1Won ? row.p1 : row.p2;
      }
    });
    raw.forEach(function(item) {
      var row = bracketByNum[item.match.id], r = item.round;
      if (row.is_bye || row.status !== 'COMPLETED' || !row.p1 || !row.p2 || (!row.p1Won && !row.p2Won)) return;
      var lo = Number(r.minimumPlace), hi = Number(r.maximumPlace);
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi < lo) return;
      var winner = row.p1Won ? row.p1 : row.p2;
      var loser = row.p1Won ? row.p2 : row.p1;
      if (lo === 1 && hi === 2) {
        var conditional = r.roundOutputType === 'ConditionalFinal' ||
          (/^F1$/i.test(r.roundName || '') && raw.some(function(next) {
            return /^F2$/i.test(next.round.roundName || '') || next.round.isDoubleFinal;
          }));
        if (conditional) {
          // F1 settles the title only if the undefeated finalist wins. A
          // challenger win requires the reset final; do not award places yet.
          if (!winnerBracketChampion || winnerBracketChampion.id !== winner.id) return;
          if (raw.some(function(next) {
            return (next.round.isDoubleFinal || /^F2$/i.test(next.round.roundName || '')) &&
              bracketByNum[next.match.id].status === 'COMPLETED' &&
              (bracketByNum[next.match.id].p1Won || bracketByNum[next.match.id].p2Won);
          })) return;
        } else if (row.winnerTo && bracketByNum[row.winnerTo]) return;
        places[winner.id] = '1';
        places[loser.id] = '2';
      } else if (!row.loserTo) {
        places[loser.id] = lo === hi ? String(lo) : lo + '-' + hi;
      }
    });
    Object.keys(bracketByNum).forEach(function(num) {
      [bracketByNum[num].p1, bracketByNum[num].p2].forEach(function(participant) {
        if (participant) participant.place = places[participant.id] || null;
      });
    });
    anyLive = Object.keys(bracketByNum).some(function(num) { return bracketByNum[num].status === 'IN_PROGRESS'; });
    allDone = raw.length > 0 && Object.keys(bracketByNum).every(function(num) { return bracketByNum[num].status === 'COMPLETED'; });
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

  // Infer an overdue match only after reserving tables for published live
  // matches and the earliest ready overdue matches across the tournament.
  function inferInProgress(result, otherResults, now) {
    now = now == null ? Date.now() : now;
    function tables(row) {
      var label = String(row.tableName || ''), found = [];
      label.split(/[,/&]+/).forEach(function(part) {
        var range = /^\s*(?:Table\s*)?(\d+)\s*-\s*(\d+)\s*$/i.exec(part);
        if (range && Number(range[2]) >= Number(range[1]) && Number(range[2]) - Number(range[1]) < 50) {
          for (var n = Number(range[1]); n <= Number(range[2]); n++) found.push(String(n));
        } else (part.match(/\d+/g) || []).forEach(function(number) { found.push(String(Number(number))); });
      });
      return Array.from(new Set(found));
    }
    function playerKeys(row) {
      var names = [];
      [row.p1, row.p2].forEach(function(player) {
        if (!player) return;
        names.push(player.name);
        (player.searchMembers || []).forEach(function(member) { names.push(member.name); });
      });
      return Array.from(new Set(names.filter(Boolean).map(function(name) {
        return String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
          .split('/').map(function(part) { return part.trim(); }).sort().join('/');
      })));
    }
    var rows = [], occupied = new Set(), occupiedPlayers = new Set(), candidates = [], inferred = new Set();
    [result].concat(otherResults || []).forEach(function(bracket) {
      Object.keys(bracket.bracketByNum || {}).forEach(function(num) {
        var row = bracket.bracketByNum[num];
        var status = row.inferredInProgress ? row.publishedStatus : row.status;
        var assigned = tables(row);
        var key = String(row.num);
        rows.push({ row: row, status: status, tables: assigned, players: playerKeys(row), key: key });
      });
    });
    rows.forEach(function(item) {
      if (item.status === 'IN_PROGRESS') {
        item.tables.forEach(function(table) { occupied.add(table); });
        item.players.forEach(function(player) { occupiedPlayers.add(player); });
      }
      var time = Date.parse(item.row.scheduledTime);
      if (item.status === 'NOT_STARTED' && !item.row.is_bye && item.row.p1 && item.row.p2 &&
          item.tables.length && isFinite(time) && time <= now) {
        item.time = time; candidates.push(item);
      }
    });
    candidates.sort(function(a, b) { return a.time - b.time || Number(a.key) - Number(b.key); });
    candidates.forEach(function(item) {
      if (item.tables.some(function(table) { return occupied.has(table); }) ||
          item.players.some(function(player) { return occupiedPlayers.has(player); })) return;
      inferred.add(item.key);
      item.tables.forEach(function(table) { occupied.add(table); });
      item.players.forEach(function(player) { occupiedPlayers.add(player); });
    });
    var count = 0;
    Object.keys(result.bracketByNum || {}).forEach(function(num) {
      var row = result.bracketByNum[num];
      if (row.inferredInProgress) { row.status = row.publishedStatus; delete row.inferredInProgress; delete row.publishedStatus; }
      if (!inferred.has(String(row.num)) || row.status !== 'NOT_STARTED') return;
      row.publishedStatus = row.status; row.status = 'IN_PROGRESS'; row.inferredInProgress = true; count++;
    });
    (result.matches || []).forEach(function(match) {
      if (match.inferredInProgress) { match.status = match.publishedStatus; delete match.inferredInProgress; delete match.publishedStatus; }
      var row = result.bracketByNum[match.num];
      if (!row || !row.inferredInProgress) return;
      match.publishedStatus = match.status; match.status = 'IN_PROGRESS'; match.inferredInProgress = true;
    });
    if (result.tournament) {
      if (count) result.tournament.status = 'IN_PROGRESS';
      else if (result.tournament.status === 'IN_PROGRESS' && !rows.some(function(item) { return item.status === 'IN_PROGRESS' && result.bracketByNum[item.key]; })) {
        result.tournament.status = (result.matches || []).every(function(match) { return match.status === 'COMPLETED'; }) ? 'COMPLETED' : 'NOT_STARTED';
      }
    }
    return count;
  }

  root.bracketBeastBuildResult = buildResult;
  root.bracketBeastInferInProgress = inferInProgress;
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildResult: buildResult, statusOf: statusOf, inferInProgress: inferInProgress };
})(typeof globalThis !== 'undefined' ? globalThis : this);
