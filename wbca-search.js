// Full-name lookup for the 2026 Western BCA Scotch Doubles and Teams entries.
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
  function fullNames(entry, includeAlternates) {
    var members = (entry.players || []).concat(includeAlternates ? (entry.alternatePlayers || []) : []);
    return members.map(function(p) { return ((p.firstName || '').trim() + ' ' + (p.lastName || '').trim()).trim(); }).filter(Boolean);
  }
  function membersFor(name, division, entries) {
    var teams = isTeamDivision(division);
    var funday = /^funday scotch doubles$/i.test(String(division || '').trim());
    var cap = /^scotch doubles\s+(\d+)\b/i.exec(String(division || '').trim());
    if (teams) cap = /\b(\d{3,4})\b/.exec(String(division));
    if (!teams && !funday && !cap) return [];
    var key = teamKey(name), candidates = Object.create(null), moved = Object.create(null);
    (entries || []).forEach(function(entry) {
      if (teams) {
        if (!/^teams$/i.test(entry.division || '') || !(entry.players || []).length) return;
      } else if (!/^scotch$/i.test(entry.division || '') || (entry.players || []).length !== 2) return;
      if (funday) {
        if (!/2026.*fun\s*day/i.test(entry.eventName || '')) return;
      } else if (!/2026.*9.ball/i.test(entry.eventName || '')) return;
      var pair = entry.players.map(function(p) { return p.lastName; }).join('/');
      if (teams ? normal(name).trim() !== normal(entry.teamName).trim()
                : !teamMatches(key, entry.teamName) && !teamMatches(key, pair)) return;
      var names = fullNames(entry, teams);
      var target = funday || !cap || Number(entry.divisionType && entry.divisionType.fargoUp) === Number(cap[1]) ? candidates : moved;
      target[names.map(normal).sort().join('|')] = names;
    });
    // Entries retain their registration cap after some teams change division.
    // Use an exact pair from another cap only when it is unambiguous.
    if (!Object.keys(candidates).length) candidates = moved;
    var keys = Object.keys(candidates);
    // Identical surnames can belong to different pairs. Do not guess.
    return keys.length === 1 ? candidates[keys[0]] : [];
  }
  function enrich(players, entries) {
    players.forEach(function(p) { p.searchNames = membersFor(p.name, p.division, entries); });
    return players;
  }
  function registeredTeams(entries) {
    var byTeam = Object.create(null);
    (entries || []).forEach(function(entry) {
      if (!/^teams$/i.test(entry.division || '') || !/2026.*9.ball/i.test(entry.eventName || '') || !entry.teamName) return;
      var division = 'Teams ' + ((entry.divisionType || {}).name || ''), key = normal(entry.teamName).trim() + '|' + normal(division);
      if (!byTeam[key]) byTeam[key] = { name: entry.teamName.trim(), division: division, slug: null, searchNames: [] };
      fullNames(entry, true).forEach(function(name) { if (byTeam[key].searchNames.indexOf(name) < 0) byTeam[key].searchNames.push(name); });
    });
    return Object.keys(byTeam).map(function(key) { return byTeam[key]; });
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
    membersFor: membersFor, enrich: enrich, registeredTeams: registeredTeams, loadEntries: loadEntries };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.wbcaSearch;
})(typeof globalThis !== 'undefined' ? globalThis : this);
