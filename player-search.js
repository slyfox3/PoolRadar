// Shared player search overlay markup, ranking, and result rendering.
(function(root) {
  'use strict';
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function highlight(name, tokens) {
    var escaped = tokens.map(function(token) { return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    if (!escaped.length) return esc(name);
    return String(name).split(new RegExp('(' + escaped.join('|') + ')', 'ig')).map(function(part, i) {
      return i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part);
    }).join('');
  }
  function normal(value) {
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  function rankPlayers(query, players) {
    var tokens = normal(query).trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return players.slice().sort(function(a, b) { return a.name.localeCompare(b.name); });
    var scored = [];
    players.forEach(function(player) {
      var name = normal([player.name].concat(player.searchNames || []).join(' '));
      var words = name.split(/[\s/\\,&-]+/), score = 0;
      for (var i = 0; i < tokens.length; i++) {
        var token = tokens[i];
        if (name.indexOf(token) === 0) continue;
        if (words.some(function(word) { return word.indexOf(token) === 0; })) { score++; continue; }
        if (name.indexOf(token) !== -1) { score += 3; continue; }
        return;
      }
      scored.push({ player: player, score: score });
    });
    return scored.sort(function(a, b) { return a.score - b.score || a.player.name.localeCompare(b.player.name); })
      .map(function(result) { return result.player; });
  }
  function applySchedules(players, matches) {
    function nameKey(name) { return normal(name).trim().replace(/\s*\/\s*/g, '/'); }
    var byName = new Map(players.map(function(player) { delete player.scheduledMatch; return [nameKey(player.name), player]; }));
    matches.forEach(function(match) {
      if (match.status !== 'NOT_STARTED' || match.isBye || match.is_bye || (!match.tableName && !match.scheduledTime)) return;
      var time = match.scheduledTime ? Date.parse(match.scheduledTime) : Infinity;
      if (isNaN(time)) time = Infinity;
      [match.p1, match.p2].forEach(function(participant) {
        if (!participant) return;
        var player = byName.get(nameKey(participant.name));
        if (!player) return;
        var previous = player.scheduledMatch;
        var previousTime = previous && previous.scheduledTime ? Date.parse(previous.scheduledTime) : Infinity;
        if (isNaN(previousTime)) previousTime = Infinity;
        if (!previous || time < previousTime) player.scheduledMatch = {
          tableName: match.tableName || null, scheduledTime: match.scheduledTime || null, matchNumber: match.identifier || null
        };
      });
    });
    return players;
  }
  function scheduleLabel(schedule) {
    if (!schedule) return '';
    var parts = [];
    if (schedule.tableName) parts.push('T' + String(schedule.tableName).replace(/^Table\s*/i, ''));
    var date = new Date(schedule.scheduledTime);
    if (schedule.scheduledTime && !isNaN(date.getTime())) {
      var day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      var time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        .replace(/\s*([AP])M$/i, function(_, p) { return p.toLowerCase() + 'm'; });
      var today = new Date();
      var sameDay = date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
      var tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      var nextDay = date.getFullYear() === tomorrow.getFullYear() &&
        date.getMonth() === tomorrow.getMonth() && date.getDate() === tomorrow.getDate();
      parts.push((sameDay ? 'Today' : nextDay ? 'Tomorrow' : day) + ', ' + time);
    }
    return parts.join(' · ');
  }
  function renderResults(entries, options) {
    options = options || {};
    var tokens = String(options.query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    var flag = options.flagHtml || function() { return ''; };
    var hits = entries.filter(function(entry) { return entry.kind !== 'section'; });
    if (!hits.length) return '<div class="pse-empty">No player or country matches &ldquo;' + esc(options.query) + '&rdquo;</div>';
    var cursor = -1;
    var html = entries.map(function(entry) {
      if (entry.kind === 'section') return '<div class="pse-section">' + esc(entry.label) + '</div>';
      var active = ++cursor === 0 ? ' active' : '';
      if (entry.kind === 'country') {
        var country = entry.country, count = country.players.length;
        return '<div class="pse-item pse-country' + active + '" role="option" data-country="' + esc(country.code) + '">' +
          flag(country.code, country.name, 'pse-flag') + '<span class="pse-name">' + highlight(country.name, tokens) + '</span>' +
          '<span class="pse-meta">' + count + ' player' + (count === 1 ? '' : 's') + '</span><span class="pse-chevron">&#9656;</span></div>';
      }
      var player = entry.player;
      var favorite = options.isFavorite && options.isFavorite(player);
      var href = options.playerHref && options.playerHref(player);
      var tag = href ? 'a' : 'div';
      var row = '<' + tag + ' class="pse-item' + active + (favorite ? ' is-fav' : '') + '" role="option" data-index="' + cursor + '" data-name="' + esc(player.name) + '"' + (href ? ' href="' + esc(href) + '"' : '') + '>' +
        '<span class="pse-name">' + flag(player.country, player.countryName, 'pf') + highlight(player.name, tokens);
      if (player.rating != null) row += ' (' + esc(player.rating) + ')';
      var members = player.searchMembers || [];
      if (members.length && !(members.length === 1 && members[0].name === player.name)) {
        row += '<span class="pse-members">' + members.map(function(member) {
          return highlight(member.name + (member.rating == null ? '' : ' (' + member.rating + ')'), tokens);
        }).join(' / ') + '</span>';
      } else if (!members.length && (player.searchNames || []).length) {
        row += '<span class="pse-members">' + highlight(player.searchNames.join(' / '), tokens) + '</span>';
      }
      var scheduled = scheduleLabel(player.scheduledMatch);
      if (scheduled) row += '<span class="pse-schedule">' + esc(scheduled) + '</span>';
      if (options.playerDetailsHtml) row += '<span class="pse-details">' + options.playerDetailsHtml(player) + '</span>';
      row += '</span>';
      var meta = options.playerMetaHtml ? options.playerMetaHtml(player) : (player.place ? esc('Place: ' + player.place) : '');
      if (meta) row += '<span class="pse-meta">' + meta + '</span>';
      return row + '</' + tag + '>';
    }).join('');
    if (options.capped) html += '<div class="pse-empty">Showing ' + hits.length + ' of ' + options.total + ' &mdash; keep typing to narrow</div>';
    return html;
  }
  function mountOverlay(options) {
    var host = document.getElementById(options.hostId);
    host.innerHTML = '<div class="pse-overlay" id="' + esc(options.overlayId) + '" role="dialog" aria-modal="true" aria-label="Find a player or a country">' +
      '<div class="pse-box"><div class="pse-bar"><svg class="pse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.7-4.7"/></svg>' +
      '<input class="pse-input" type="text" id="' + esc(options.inputId) + '" placeholder="Player or country…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" aria-label="Player or country" aria-autocomplete="list" aria-controls="' + esc(options.resultsId) + '">' +
      '<button class="pse-close" id="' + esc(options.closeId) + '" aria-label="Close search">&times;</button></div>' +
      (options.hintId ? '<div class="pse-hint" id="' + esc(options.hintId) + '" hidden></div>' : '') +
      '<div class="pse-results" id="' + esc(options.resultsId) + '" role="listbox"></div></div></div>';
  }
  var api = { mountOverlay: mountOverlay, rankPlayers: rankPlayers, applySchedules: applySchedules, scheduleLabel: scheduleLabel, renderResults: renderResults };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.playerSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
