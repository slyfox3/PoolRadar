// Full names and Fargo ratings from the 2026 Western BCA entries.
(function(root) {
  'use strict';
  var loads = Object.create(null);
  function normal(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  function teamKey(name) {
    return normal(name).split('/').map(function(part) { return part.replace(/[\s,]/g, ''); }).sort().join('/');
  }
  function teamMatches(key, name) {
    if (key === teamKey(name)) return true;
    var parts = String(name || '').split('/');
    // Some brackets use a hyphen between the two surnames. Generate aliases
    // from the known pair, preserving hyphens within a surname.
    return parts.length === 2 && (key === teamKey(parts.join('-')) || key === teamKey(parts.reverse().join('-')));
  }
  function isScotchDivision(division) {
    return /^(?:Funday Scotch Doubles|Scotch Doubles\s+\d+\b)/i.test(String(division || '').trim());
  }
  function isTeamDivision(division) {
    return /\bteams?\b/i.test(String(division || ''));
  }
  function fullMembers(entry, includeAlternates) {
    var primaryCount = (entry.players || []).length;
    var members = (entry.players || []).concat(includeAlternates ? (entry.alternatePlayers || []) : []);
    return members.map(function(p, index) {
      var name = ((p.firstName || '').trim() + ' ' + (p.lastName || '').trim()).trim();
      var rating = p.fargoRate == null || String(p.fargoRate).trim() === '' ? null : Number(p.fargoRate);
      return { name: name, rating: rating != null && isFinite(rating) ? rating : null, isAlternate: index >= primaryCount };
    }).filter(function(p) { return p.name; });
  }
  function memberLabel(member) {
    return member.name + (member.rating == null ? '' : ' (' + member.rating + ')');
  }
  function teamRating(members) {
    members = members.filter(function(member) { return !member.isAlternate; });
    if (!members.length || members.some(function(member) { return typeof member.rating !== 'number' || !isFinite(member.rating); })) return null;
    return members.reduce(function(total, member) { return total + member.rating; }, 0);
  }
  function memberInfoFor(name, division, entries) {
    var teams = isTeamDivision(division);
    var singles = !teams && !isScotchDivision(division);
    var funday = /^funday scotch doubles$/i.test(String(division || '').trim());
    if (singles) funday = /^funday\b/i.test(String(division || '').trim());
    var cap = /^scotch doubles\s+(\d+)\b/i.exec(String(division || '').trim());
    if (teams) cap = /\b(\d{3,4})\b/.exec(String(division));
    if (!singles && !teams && !funday && !cap) return [];
    var key = teamKey(name), candidates = Object.create(null), moved = Object.create(null);
    (entries || []).forEach(function(entry) {
      if (singles) {
        if (!/^singles$/i.test(entry.division || '') || (entry.players || []).length !== 1) return;
      } else if (teams) {
        if (!/^teams$/i.test(entry.division || '') || !(entry.players || []).length) return;
      } else if (!/^scotch$/i.test(entry.division || '') || (entry.players || []).length !== 2) return;
      if (funday) {
        if (!/2026.*fun\s*day/i.test(entry.eventName || '')) return;
      } else if (!/2026.*9.ball/i.test(entry.eventName || '')) return;
      var pair = entry.players.map(function(p) { return p.lastName; }).join('/');
      if (singles ? normal(name).trim() !== normal(fullMembers(entry)[0].name).trim()
                 : teams ? normal(name).trim() !== normal(entry.teamName).trim()
                : !teamMatches(key, entry.teamName) && !teamMatches(key, pair)) return;
      var members = fullMembers(entry, teams);
      var target = funday || !cap || Number(entry.divisionType && entry.divisionType.fargoUp) === Number(cap[1]) ? candidates : moved;
      target[members.map(function(p) { return normal(p.name); }).sort().join('|')] = members;
    });
    // Entries retain their registration cap after some teams change division.
    // Use an exact pair from another cap only when it is unambiguous.
    if (!Object.keys(candidates).length) candidates = moved;
    var keys = Object.keys(candidates);
    // Identical surnames can belong to different pairs. Do not guess.
    return keys.length === 1 ? candidates[keys[0]] : [];
  }
  function membersFor(name, division, entries) {
    return memberInfoFor(name, division, entries).map(function(p) { return p.name; });
  }
  function enrich(players, entries) {
    players.forEach(function(p) {
      var members = memberInfoFor(p.name, p.division, entries);
      p.searchMembers = members;
      p.searchNames = members.map(function(member) { return member.name; });
      if (isTeamDivision(p.division) || isScotchDivision(p.division)) p.rating = teamRating(members);
      else if (members.length === 1) p.rating = members[0].rating;
    });
    return players;
  }
  function registeredTeams(entries) {
    var byTeam = Object.create(null);
    (entries || []).forEach(function(entry) {
      if (!/^teams$/i.test(entry.division || '') || !/2026.*9.ball/i.test(entry.eventName || '') || !entry.teamName) return;
      var division = 'Teams ' + ((entry.divisionType || {}).name || ''), key = normal(entry.teamName).trim() + '|' + normal(division);
      if (!byTeam[key]) byTeam[key] = { name: entry.teamName.trim(), division: division, slug: null, searchNames: [], searchMembers: [] };
      fullMembers(entry, true).forEach(function(member) {
        if (byTeam[key].searchNames.indexOf(member.name) < 0) {
          byTeam[key].searchNames.push(member.name);
          byTeam[key].searchMembers.push(member);
        }
      });
    });
    return Object.keys(byTeam).map(function(key) {
      byTeam[key].rating = teamRating(byTeam[key].searchMembers);
      return byTeam[key];
    });
  }
  function loadEntries(base, division) {
    division = division || 'Scotch';
    var cacheKey = base + '|' + division;
    if (loads[cacheKey]) return loads[cacheKey];
    function page(number) {
      var query = new URLSearchParams({ search: 'general:,year:2026,division:' + division, page: number, limit: 100 });
      return fetch(base + '/wbca/entries?' + query).then(function(r) {
        return r.json().then(function(data) {
          if (!r.ok) throw new Error(data.message || data.error || ('HTTP ' + r.status));
          if (!Array.isArray(data.entries)) throw new Error('Invalid Western BCA entries response.');
          return data;
        });
      });
    }
    loads[cacheKey] = page(1).then(function(first) {
      var count = Math.ceil(Number(first.total || 0) / 100), jobs = [];
      if (count > 30) throw new Error('Western BCA returned too many entries.');
      for (var i = 2; i <= count; i++) jobs.push(page(i));
      return Promise.all(jobs).then(function(rest) {
        return rest.reduce(function(all, next) { return all.concat(next.entries); }, first.entries);
      });
    }).catch(function(error) { delete loads[cacheKey]; throw error; });
    return loads[cacheKey];
  }
  root.wbcaSearch = { isScotchDivision: isScotchDivision, isTeamDivision: isTeamDivision,
    membersFor: membersFor, memberInfoFor: memberInfoFor, memberLabel: memberLabel, teamRating: teamRating,
    enrich: enrich, registeredTeams: registeredTeams, loadEntries: loadEntries };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.wbcaSearch;
})(typeof globalThis !== 'undefined' ? globalThis : this);
