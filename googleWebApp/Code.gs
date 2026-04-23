var SHEET_NAME = 'videos';
var CHANNEL_ID = 'UCTlcpma6Dx7uIZN0dFJJl9w'; // @EvoSportsStreaming
var RSS_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + CHANNEL_ID;

// EvoSports descriptions use venue local time with no timezone indicator.
// Most venues are US-based; Apps Script parses in project timezone (America/Los_Angeles).
function parseMatchTime(text) {
  var m = text.match(/Match Start time:\s*(\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*[AP]M)/i);
  if (!m) return null;
  var parsed = new Date(m[1]);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// =====================================================
// Timed trigger: fetch RSS every 10 minutes
// Run setupTrigger() once manually to install
// =====================================================
function setupTrigger() {
  // Remove existing triggers to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'fetchRSS') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('fetchRSS').timeBased().everyMinutes(10).create();
}

function fetchRSS() {
  var xml;
  try {
    xml = UrlFetchApp.fetch(RSS_URL).getContentText();
  } catch (e) {
    Logger.log('fetchRSS: HTTP fetch failed: ' + e.message);
    return 0;
  }

  var doc;
  try {
    doc = XmlService.parse(xml);
  } catch (e) {
    Logger.log('fetchRSS: XML parse failed: ' + e.message);
    return 0;
  }

  var root = doc.getRootElement();
  var atom = root.getNamespace();
  var mediaNs = XmlService.getNamespace('media', 'http://search.yahoo.com/mrss/');
  var ytNs = XmlService.getNamespace('yt', 'http://www.youtube.com/xml/schemas/2015');

  var entries = root.getChildren('entry', atom);
  var newVideos = [];

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var videoId = entry.getChild('videoId', ytNs);
    if (!videoId) continue;

    var title = entry.getChildText('title', atom) || '';
    var publishedAt = entry.getChildText('published', atom) || '';

    var matchTime = null;
    var mediaGroup = entry.getChild('group', mediaNs);
    if (mediaGroup) {
      matchTime = parseMatchTime(mediaGroup.getChildText('description', mediaNs) || '');
    }

    newVideos.push({
      videoId: videoId.getText(),
      title: title,
      matchTime: matchTime,
      publishedAt: publishedAt ? new Date(publishedAt) : null
    });
  }

  if (newVideos.length === 0) return 0;

  var sheet = getOrCreateSheet();
  var existing = getExistingVideoIds(sheet);
  var rows = [];

  for (var j = 0; j < newVideos.length; j++) {
    var v = newVideos[j];
    if (existing[v.videoId]) continue;
    rows.push([v.videoId, v.title, v.matchTime, v.publishedAt, new Date()]);
  }

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  }
  return rows.length;
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

  var rssMs = 0;
  if (rangeCoversNow(to)) {
    var t2 = Date.now();
    fetchRSS();
    rssMs = Date.now() - t2;
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

  var timing = { total: totalMs, rss: rssMs, read: readMs, filter: filterMs, rows: data.length - 1, matched: videos.length };
  Logger.log('doGet timing: ' + JSON.stringify(timing));

  return ContentService
    .createTextOutput(JSON.stringify({ videos: videos, _timing: timing }))
    .setMimeType(ContentService.MimeType.JSON);
}

// =====================================================
// YouTube API backfill via YouTube Advanced Service
// Enable: Services (+) → YouTube Data API v3 → Add
// =====================================================
var UPLOADS_PLAYLIST = 'UU' + CHANNEL_ID.slice(2);

function backfillYouTubeVideos(weeks) {
  if (!weeks) weeks = 6;
  var cutoff = new Date(Date.now() - weeks * 7 * 24 * 3600000);
  var sheet = getOrCreateSheet();
  var existing = getExistingVideoIds(sheet);
  var pageToken = '';
  var totalAdded = 0;
  var reachedCutoff = false;
  var pageNum = 0;

  do {
    pageNum++;
    var opts = { playlistId: UPLOADS_PLAYLIST, maxResults: 50 };
    if (pageToken) opts.pageToken = pageToken;
    var response = YouTube.PlaylistItems.list('snippet', opts);
    var items = response.items || [];
    if (items.length === 0) break;

    // Collect video IDs for this page, check if we've passed the cutoff
    var videoIds = [];
    for (var i = 0; i < items.length; i++) {
      var pubDate = new Date(items[i].snippet.publishedAt);
      if (pubDate < cutoff) { reachedCutoff = true; break; }
      var vid = items[i].snippet.resourceId.videoId;
      if (!existing[vid]) videoIds.push(vid);
    }

    // Batch fetch descriptions for new videos
    if (videoIds.length > 0) {
      var details = YouTube.Videos.list('snippet', { id: videoIds.join(',') });
      var rows = [];
      for (var j = 0; j < details.items.length; j++) {
        var v = details.items[j];
        var desc = v.snippet.description || '';
        var matchTime = parseMatchTime(desc);
        rows.push([v.id, v.snippet.title, matchTime, new Date(v.snippet.publishedAt), new Date()]);
        existing[v.id] = true;
      }
      if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
        totalAdded += rows.length;
      }
    }

    var oldest = items[items.length - 1] ? items[items.length - 1].snippet.publishedAt : '?';
    Logger.log('Page ' + pageNum + ': ' + items.length + ' items, ' + videoIds.length + ' new, oldest=' + oldest);

    pageToken = response.nextPageToken || '';
  } while (pageToken && !reachedCutoff);

  Logger.log('Backfill complete: added ' + totalAdded + ' videos (cutoff: ' + weeks + ' weeks)');
  return totalAdded;
}

function ensureBackfill(weeks) {
  if (!weeks) weeks = 6;
  var sheet = getOrCreateSheet();
  if (sheet.getLastRow() >= 2) return 0;
  Logger.log('Sheet empty, running backfill for ' + weeks + ' weeks');
  return backfillYouTubeVideos(weeks);
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
