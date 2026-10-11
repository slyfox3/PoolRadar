'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');
function extract(name) {
  const start = html.indexOf('  function ' + name + '(');
  assert(start >= 0);
  return html.slice(start, html.indexOf('\n  }', start) + 4);
}
class FixedDate extends Date { static now() { return Date.parse('2026-10-11T16:47:00Z'); } }
const context = { Date: FixedDate, GENERIC_VENUE_WORDS: ['the', 'billiards'], MAX_ARCHIVED_LIVESTREAM_OFFSET_SEC: 42900 };
vm.createContext(context);
vm.runInContext(fs.readFileSync('stream-mappings.js', 'utf8'), context);
vm.runInContext(['extractTableNum', 'extractVenueFromTitle', 'getKnownVenueStream', 'isOpeningStreamMatchWithoutStart', 'matchLivestreamsToMatches'].map(extract).join('\n'), context);
const tournament = { source: 'bracketbeast', slug: '53/488/696', venue: { id: null, name: 'Chinook Winds Casino' } };
const channelId = 'UC42Kp7cvohBsB3Yg4gFVj5w';
function video(videoId, time) {
  return { videoId, title: 'WBCA 9BALL SCOTCH DOUBLES 2026', channelId,
    channelTitle: 'On The Wire Creative Media', tableNum: '', matchTime: Date.parse(time) };
}
const videos = [video('L9oRFSYMWVc', '2026-10-11T16:20:41Z'), video('Zf2FVs4XS0k', '2026-10-11T15:54:52Z'), video('6J5ulKPbrWE', '2026-10-11T15:45:04Z')];
const match = { num: 74958, tableName: '9', status: 'NOT_STARTED', scheduledTime: '2026-10-11T16:00:00Z',
  p1: { name: 'Cuenca/Honrado' }, p2: { name: 'Sapaden/Pajarillo' } };
assert.equal(context.extractTableNum('9'), '9');
assert.equal(context.extractTableNum('Table 009'), '9');
assert.equal(context.extractTableNum('WBCA - TABLE 9'), '9');
assert.equal(context.getKnownVenueStream(tournament, videos[0]).tableNum, '9');
assert.equal(context.getKnownVenueStream({ ...tournament, slug: '54/488/696' }, videos[0]), null);
assert.equal(context.getKnownVenueStream(tournament, { ...videos[0], channelId: 'another-channel' }), null);
assert.equal(context.matchLivestreamsToMatches([match], videos, tournament), 1);
assert.equal(match.videoUrl, 'https://www.youtube.com/watch?v=Zf2FVs4XS0k&t=308', '9am match seeks 5:08 into the broadcast covering its start');
const noVenue = { ...match, videoUrl: null };
assert.equal(context.matchLivestreamsToMatches([noVenue], videos, { ...tournament, venue: null }), 1);
const otherTable = { ...match, videoUrl: null, tableName: '11' };
assert.equal(context.matchLivestreamsToMatches([otherTable], videos, tournament), 0);
const future = { ...match, videoUrl: null, scheduledTime: '2026-10-11T17:45:00Z' };
assert.equal(context.matchLivestreamsToMatches([future], videos, tournament), 0, 'future matches do not get timestamps beyond the live edge');
const afterRestart = { ...match, videoUrl: null, scheduledTime: null, startTime: '2026-10-11T16:25:00Z' };
context.matchLivestreamsToMatches([afterRestart], videos, tournament);
assert.equal(afterRestart.videoUrl, 'https://www.youtube.com/watch?v=L9oRFSYMWVc&t=259', 'later match uses the restarted broadcast');
const atStart = { ...match, videoUrl: null, scheduledTime: null, startTime: '2026-10-11T16:20:41Z' };
context.matchLivestreamsToMatches([atStart], videos, tournament);
assert.equal(atStart.videoUrl, 'https://www.youtube.com/watch?v=L9oRFSYMWVc&t=1', 't=0 must not jump to the live edge');
const old = { ...match, videoUrl: null, scheduledTime: null, startTime: '2026-10-11T16:30:00Z' };
assert.equal(context.matchLivestreamsToMatches([old], [video('old-stream', '2026-10-10T15:54:52Z')], tournament), 0);
const blackDiamond = { source: 'digitalpool', venue: { id: 862, name: 'The Black Diamond' } };
assert.equal(context.getKnownVenueStream(blackDiamond, { channelId: 'UCOKrmdnCIee9WYvQJFsmRpA' }).tableNum, '9', 'existing venue mappings remain available');
console.log('Table 9 livestream: event/channel scope, numeric tables, scheduled start offsets, restarts, future times, and existing venue mapping passed.');
