var SHEET_NAME = 'videos';
var CHANNEL_ID = 'UCTlcpma6Dx7uIZN0dFJJl9w'; // @EvoSportsStreaming

// EvoSports descriptions use venue local time with no timezone indicator.
// Most venues are US-based; Apps Script parses in project timezone (America/Los_Angeles).
function parseMatchTime(text) {
  var m = text.match(/Match Start time:\s*(\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*[AP]M)/i);
  if (!m) return null;
  var parsed = new Date(m[1]);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// =====================================================
// Timed trigger: fetch latest videos every 10 minutes
// Run setupTrigger() once manually to install
// =====================================================
var FETCH_THROTTLE_MS = 2 * 60 * 1000; // 2 minutes

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'fetchLatest' || fn === 'fetchRSS') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('fetchLatest').timeBased().everyMinutes(10).create();
}

function fetchLatest() {
  var props = PropertiesService.getScriptProperties();
  var lastFetch = parseInt(props.getProperty('lastFetchMs')) || 0;
  var now = Date.now();
  if (now - lastFetch < FETCH_THROTTLE_MS) {
    Logger.log('fetchLatest: throttled (' + Math.round((now - lastFetch) / 1000) + 's since last fetch)');
    return 0;
  }
  props.setProperty('lastFetchMs', String(now));
  return fetchPlaylistVideos({ maxPages: 1 });
}

function rangeCoversNow(to) {
  if (!to) return true;
  return new Date(to) >= new Date();
}

// =====================================================
// Web endpoint: GET ?from=ISO_TIMESTAMP&to=ISO_TIMESTAMP
// =====================================================
function doGet(e) {
  var t0 = Date.now();
  var from = e.parameter.from || '';
  var to = e.parameter.to || '';
  var weeks = parseInt(e.parameter.weeks) || 6;

  ensureBackfill(weeks);

  var fetchMs = 0;
  if (rangeCoversNow(to)) {
    var t2 = Date.now();
    fetchLatest();
    fetchMs = Date.now() - t2;
  }

  var t3 = Date.now();
  var sheet = getOrCreateSheet();
  var data = sheet.getDataRange().getValues();
  var readMs = Date.now() - t3;

  var t4 = Date.now();
  var fromDate = from ? new Date(from) : null;
  var toDate = to ? new Date(to) : null;

  var videos = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var matchTime = row[2];
    if (!matchTime) continue;
    if (fromDate && matchTime < fromDate) continue;
    if (toDate && matchTime > toDate) continue;
    videos.push({
      videoId: row[0],
      title: row[1],
      matchTime: matchTime instanceof Date ? matchTime.toISOString() : matchTime
    });
  }
  var filterMs = Date.now() - t4;
  var totalMs = Date.now() - t0;

  var timing = { total: totalMs, fetch: fetchMs, read: readMs, filter: filterMs, rows: data.length - 1, matched: videos.length };
  Logger.log('doGet timing: ' + JSON.stringify(timing));

  return ContentService
    .createTextOutput(JSON.stringify({ videos: videos, _timing: timing }))
    .setMimeType(ContentService.MimeType.JSON);
}

// =====================================================
// YouTube API via YouTube Advanced Service
// Enable: Services (+) → YouTube Data API v3 → Add
// =====================================================
var UPLOADS_PLAYLIST = 'UU' + CHANNEL_ID.slice(2);

function fetchPlaylistVideos(opts) {
  var cutoff = opts.cutoff || null;
  var maxPages = opts.maxPages || 0;
  var sheet = getOrCreateSheet();
  var existing = getExistingVideoIds(sheet);
  var pageToken = '';
  var totalAdded = 0;
  var reachedCutoff = false;
  var pageNum = 0;
  var t0 = Date.now();

  do {
    pageNum++;
    var reqOpts = { playlistId: UPLOADS_PLAYLIST, maxResults: 50 };
    if (pageToken) reqOpts.pageToken = pageToken;
    var response = YouTube.PlaylistItems.list('snippet', reqOpts);
    var items = response.items || [];
    if (items.length === 0) break;

    var videos = [];
    for (var i = 0; i < items.length; i++) {
      var s = items[i].snippet;
      var pubDate = new Date(s.publishedAt);
      if (cutoff && pubDate < cutoff) { reachedCutoff = true; break; }
      videos.push({
        videoId: s.resourceId.videoId,
        title: s.title,
        description: s.description || '',
        publishedAt: pubDate
      });
    }
    var added = writeNewVideos(videos, sheet, existing);
    totalAdded += added;

    var oldest = items[items.length - 1] ? items[items.length - 1].snippet.publishedAt : '?';
    Logger.log('Page ' + pageNum + ': ' + items.length + ' items, ' + added + ' new, oldest=' + oldest);

    pageToken = response.nextPageToken || '';
  } while (pageToken && !reachedCutoff && (!maxPages || pageNum < maxPages));

  var elapsed = Date.now() - t0;
  Logger.log('Fetch complete: added ' + totalAdded + ' videos, ' + pageNum + ' pages in ' + (elapsed/1000).toFixed(1) + 's (' + (pageNum ? Math.round(elapsed/pageNum) : 0) + 'ms/page)');
  return totalAdded;
}

function backfillYouTubeVideos(weeks) {
  if (!weeks) weeks = 6;
  var cutoff = new Date(Date.now() - weeks * 7 * 24 * 3600000);
  return fetchPlaylistVideos({ cutoff: cutoff });
}

function ensureBackfill(weeks) {
  if (!weeks) weeks = 6;
  var sheet = getOrCreateSheet();
  if (sheet.getLastRow() >= 2) return 0;
  Logger.log('Sheet empty, running backfill for ' + weeks + ' weeks');
  return backfillYouTubeVideos(weeks);
}

// =====================================================
// Shared: dedup + parse + write
// =====================================================
function writeNewVideos(videos, sheet, existing) {
  var rows = [];
  for (var i = 0; i < videos.length; i++) {
    var v = videos[i];
    if (existing[v.videoId]) continue;
    var matchTime = parseMatchTime(v.description);
    if (!matchTime) Logger.log('WARNING: no matchTime for ' + v.videoId + ' | ' + v.title.substring(0, 60));
    rows.push([v.videoId, v.title, matchTime, v.publishedAt, new Date()]);
    existing[v.videoId] = true;
  }
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  }
  return rows.length;
}

// =====================================================
// Helpers
// =====================================================
function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, 5).setValues([['videoId', 'title', 'matchTime', 'publishedAt', 'fetchedAt']]);
  }
  return sheet;
}

function getExistingVideoIds(sheet) {
  var ids = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return ids;
  // Read only the videoId column (column 1) instead of the entire sheet
  var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    ids[data[i][0]] = true;
  }
  return ids;
}

function runBackfill() { backfillYouTubeVideos(20); }
