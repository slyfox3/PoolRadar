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
  var singlesTiers = [
    { tier: 'Platinum', min: 535, max: 599 },
    { tier: 'Gold', min: 484, max: 534 },
    { tier: 'Silver', min: 433, max: 483 },
    { tier: 'Bronze', min: 384, max: 432 },
    { tier: 'Iron', min: 0, max: 383 },
  ];
  function singlesDivision(rating) {
    var tier = singlesTiers.find(function(t) { return typeof rating === 'number' && rating >= t.min && rating <= t.max; });
    return tier ? { name: 'Singles ' + tier.tier, acronym: 'singles-' + tier.tier.toLowerCase(), ratingRange: tier.min + '–' + tier.max }
      : { name: 'Singles Unclassified', acronym: 'singles-unclassified' };
  }
  function entryDivision(entry) {
    var type = entry.divisionType || {}, name = String(type.name || '').trim();
    if (!/2026/.test(entry.eventName || '')) return null;
    if (/fun\s*day/i.test(entry.eventName || '')) {
      if (/^scotch$/i.test(entry.division)) return { name: 'Funday Scotch Doubles', acronym: 'fsd' };
      if (/queen/i.test(name)) return { name: 'Funday Queen of the Hill', acronym: 'qoh' };
      if (/senior/i.test(name)) return { name: 'Funday Seniors', acronym: 'fs' };
      if (/bank/i.test(name)) return { name: 'Funday 9Ball Banks', acronym: 'f9b' };
      if (/10\s*ball/i.test(name)) return { name: 'Funday 10Ball', acronym: 'f10' };
      return { name: 'Funday ' + name, acronym: 'funday-' + normal(name).replace(/[^a-z0-9]+/g, '-') };
    }
    if (!/9.ball/i.test(entry.eventName || '')) return null;
    if (/^teams$/i.test(entry.division)) return { name: 'Teams ' + name, acronym: 'team' + type.fargoUp };
    if (/^scotch$/i.test(entry.division)) return { name: 'Scotch Doubles ' + type.fargoUp + ' & Under', acronym: 'sd' + type.fargoUp };
    if (/^singles$/i.test(entry.division) && name === 'Divisional Singles') {
      var member = fullMembers(entry, false)[0];
      return singlesDivision(member ? member.rating : null);
    }
    if (/^singles$/i.test(entry.division)) return { name: 'Singles ' + name,
      acronym: 'singles-' + normal(name).replace(/[^a-z0-9]+/g, '-') };
    return null;
  }
  function divisionKey(name) { return normal(name).trim().replace(/[^a-z0-9]+/g, ''); }
  function registeredDivisions(entries) {
    var divisions = Object.create(null);
    (entries || []).forEach(function(entry) {
      var d = entryDivision(entry);
      if (!d) return;
      if (!divisions[d.acronym]) divisions[d.acronym] = Object.assign({ brackets: [], entryCount: 0 }, d);
      divisions[d.acronym].entryCount++;
    });
    return Object.keys(divisions).map(function(key) { return divisions[key]; });
  }
  function registeredPlayers(division, entries) {
    var byName = Object.create(null);
    var teamDivision = isTeamDivision(division) || isScotchDivision(division);
    (entries || []).forEach(function(entry) {
      var d = entryDivision(entry);
      if (!d || divisionKey(d.name) !== divisionKey(division)) return;
      var members = fullMembers(entry, true);
      if (teamDivision) {
        var name = String(entry.teamName || '').trim();
        if (!name && isScotchDivision(division)) name = (entry.players || []).map(function(p) { return p.lastName; }).join('/');
        if (!name) return;
        var key = normal(name).trim();
        if (!byName[key]) byName[key] = { id: null, name: name, skill_level: teamRating(members),
          searchNames: members.map(function(member) { return member.name; }), searchMembers: members };
      } else {
        members.forEach(function(member) {
          var key = normal(member.name).trim();
          if (!byName[key]) byName[key] = { id: null, name: member.name, skill_level: member.rating, searchNames: [] };
        });
      }
    });
    return Object.keys(byName).map(function(key) { return byName[key]; });
  }
  function rosterSlug(division) {
    var cap = /\b(\d{3,4})\b/.exec(String(division || ''));
    return cap ? 'team' + cap[1] : 'team';
  }
  root.wbcaSearch = { isScotchDivision: isScotchDivision, isTeamDivision: isTeamDivision,
    membersFor: membersFor, memberInfoFor: memberInfoFor, memberLabel: memberLabel, teamRating: teamRating,
    enrich: enrich, registeredTeams: registeredTeams, rosterSlug: rosterSlug, registeredDivisions: registeredDivisions, registeredPlayers: registeredPlayers, loadEntries: loadEntries };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.wbcaSearch;
})(typeof globalThis !== 'undefined' ? globalThis : this);
