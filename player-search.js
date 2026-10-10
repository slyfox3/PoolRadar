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
  var api = { mountOverlay: mountOverlay, rankPlayers: rankPlayers, renderResults: renderResults };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.playerSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
