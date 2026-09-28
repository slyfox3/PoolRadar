#!/usr/bin/env python3
"""Local dev stand-in for the wnt-proxy Cloudflare Worker.

Serves the PoolRadar static files and exposes the same two routes the Worker
will:

    GET /wnt/events        -> the WNT event list (scraped, no JSON upstream)
    GET /wnt/event/<slug>  -> every stage/group of an event, merged
    GET /pbs/events        -> the PBS tournament calendar, scraped
    GET /pbs/event?path=…  -> a Pro Billiard Series page's CueScore locator

wntlivescores.com requires a session for everything, so supply one via the
WNT_SID env var or a .wnt-session file next to this script. Both hold the raw
value of the `wnt.live.sid` cookie.

    WNT_SID='s%3A...' ./wnt-dev-proxy.py 8777
"""

import html as html_mod
import http.server
import json
import os
import re
import socketserver
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://www.wntlivescores.com'
PBS_BASE = 'https://probilliardseries.com'
PBS_TRANSLATE_BASE = 'https://probilliardseries-com.translate.goog'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')

# Upstream polls itself every 33s; 20s keeps us fresh without hammering them.
EVENT_TTL = 20
EVENTS_TTL = 600
PBS_EVENTS_TTL = 600
PBS_RESOLVE_TTL = 86400
# Whether an event has a bracket at all is settled for anything already played,
# and an upcoming one gains its draw days ahead — so a day is generous either
# way, and it is what keeps a repeat visit from re-asking about the same events.
PROBE_TTL = 86400
# A batch is a URL, and a URL has a length. Two hundred slugs is about 8KB and
# comfortably more than the hundred-odd events WNT lists at once.
PROBE_MAX = 200

MAX_STAGES = 6
MAX_GROUPS = 32

_cache = {}


class WntAuthError(Exception):
    pass


def session_id():
    sid = os.environ.get('WNT_SID', '').strip()
    if sid:
        return sid
    path = os.path.join(ROOT, '.wnt-session')
    if os.path.exists(path):
        return open(path).read().strip()
    raise WntAuthError('No session. Set WNT_SID or create .wnt-session')


def fetch(path):
    """GET a WNT path with the session cookie. Raises on a bounce to /login."""
    req = urllib.request.Request(
        BASE + path,
        headers={
            'User-Agent': UA,
            'Cookie': 'wnt.live.sid=' + session_id(),
            'X-Requested-With': 'XMLHttpRequest',
        },
    )
    # A dead session 302s to /login; urllib would follow it and hand back the
    # login page as a 200, so catch the redirect instead of chasing it.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise WntAuthError('Session expired or invalid (302 -> %s)' % newurl)

    opener = urllib.request.build_opener(NoRedirect)
    with opener.open(req, timeout=30) as r:
        return r.read().decode('utf-8', 'replace')


def cached(key, ttl, producer):
    hit = _cache.get(key)
    now = time.time()
    if hit and now - hit[0] < ttl:
        return hit[1]
    val = producer()
    _cache[key] = (now, val)
    return val


def strip_tags(s):
    return html_mod.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', s))).strip()


def event_meta(slug):
    """Name/venue/dates off the event landing page's 'Event info' panel."""
    html = fetch('/events/' + slug)
    meta = {'slug': slug, 'name': slug.replace('-', ' ').title(),
            'venue': None, 'city': None, 'dates': None, 'prize': None}

    # The event page renders its name as a logo image, so the only place the
    # text lives is the event-list card.
    try:
        for ev in cached('events', EVENTS_TTL, load_events):
            if ev['slug'] == slug:
                meta['name'] = ev['name']
                break
    except Exception:
        pass

    # The info panel is a run of label/value pairs; pull them positionally.
    for label, key in (('Date', 'dates'), ('Venue', 'venue'),
                       ('Location', 'city'), ('Prize fund', 'prize')):
        m = re.search(r'>\s*' + label + r'\s*</span>\s*</div>\s*<span>(.*?)</span>',
                      html, re.S)
        if m:
            meta[key] = strip_tags(m.group(1))
    return meta


def group_matches(slug, stage, group):
    raw = fetch('/events/%s/group-matches/%d/%d/0' % (slug, stage, group))
    try:
        return json.loads(raw)
    except ValueError:
        raise WntAuthError('Non-JSON reply for stage %d group %d' % (stage, group))


def load_event(slug):
    """Walk stage 1..N and group 1..M, stopping at the first empty response.

    An absent stage/group answers {"tmp": 0, "matches": []}, which is how we
    discover the shape without hardcoding it per event.
    """
    stages = []
    for stage in range(1, MAX_STAGES + 1):
        groups = []
        for group in range(1, MAX_GROUPS + 1):
            data = group_matches(slug, stage, group)
            if not data.get('matches'):
                break
            groups.append({
                'group': group,
                'tmp': data.get('tmp'),
                'publishScheduledDate': data.get('publishScheduledDate'),
                'publishScheduledTime': data.get('publishScheduledTime'),
                'matches': data['matches'],
            })
        if not groups:
            break
        stages.append({'stage': stage, 'groups': groups})

    meta = event_meta(slug)
    meta['stages'] = stages
    meta['matchCount'] = sum(len(g['matches']) for s in stages for g in s['groups'])
    return meta


def probe_event(slug):
    """Whether an event has a bracket behind it at all, in one upstream call.

    load_event stops at the first empty response, so asking for stage 1 group 1
    IS the question — and finding out the long way costs about three seconds and
    half a megabyte for an event that turns out to hold nothing. Worth a route
    of its own because roughly half of what WNT lists is exactly that: events
    whose results were never published, indistinguishable on the events page
    from the ones that were.

    Raises rather than answering False, so probe_events can leave the slug out
    of the reply altogether. The distinction matters: a dead session would
    otherwise mark the whole calendar empty and cache it that way for a day.
    """
    return bool((group_matches(slug, 1, 1) or {}).get('matches'))


def probe_events(slugs):
    # The fan-out is the only thing batched; each answer is cached under its own
    # slug, so an overlapping request later pays for nothing it already knows.
    def one(slug):
        try:
            return slug, cached('p:' + slug, PROBE_TTL, lambda: probe_event(slug))
        except Exception:
            # Missing from the reply rather than False. A slug with no answer
            # keeps its row, which is the safe direction to fail — a dead row
            # costs a click, a wrongly hidden one costs the event.
            return slug, None

    with ThreadPoolExecutor(max_workers=8) as pool:
        pairs = list(pool.map(one, slugs))
    return {s: v for s, v in pairs if v is not None}


def load_events():
    html = fetch('/events')
    events = []
    section = None
    # Cards are emitted in document order under "Upcoming events" / "Past events".
    for chunk in re.split(r'(?=<div class="col-12 events-time-title">)', html):
        head = re.search(r'events-time-title">([^<]*)<', chunk)
        if head:
            section = strip_tags(head.group(1))
        for card in re.finditer(
                r"onclick=\"location\.href='events/([^']+)';\"(.*?)(?=<div class=\"col\">|$)",
                chunk, re.S):
            slug, body = card.group(1), card.group(2)
            title = re.search(r'event-title[^>]*>(.*?)</h3>', body, re.S)
            date = re.search(r'icon-calendar.*?<span>(.*?)</span>', body, re.S)
            locs = re.findall(r'event-location.*?</div>\s*</div>', body, re.S)
            places = re.findall(r'<div class="text-center">([^<]*)</div>',
                                locs[0] if locs else '')
            events.append({
                'slug': slug,
                # Titles end in a decorative "." span: "US Open 2026<span>.</span>"
                'name': strip_tags(title.group(1)).rstrip(' .') if title else slug,
                'dates': strip_tags(date.group(1)) if date else None,
                # strip_tags rather than a bare strip(): these two were the only
                # scraped fields that skipped it, which is why a fifth of the
                # venues came back as "Harrah&#39;s Resort" while the name and
                # the dates beside them were clean.
                'venue': strip_tags(places[0]) if len(places) > 0 else None,
                'city': strip_tags(places[1]) if len(places) > 1 else None,
                'live': 'Live Scores' in body,
                'section': section,
            })
    return events


def normalize_pbs_path(raw):
    path = (raw or '').strip('/')
    if not re.fullmatch(r'event/[A-Za-z0-9._~%/-]+', path):
        return None
    if any(part in ('', '.', '..') for part in path.split('/')):
        return None
    return path


def fetch_pbs_html(path):
    headers = {'User-Agent': UA, 'Accept': 'text/html'}
    urls = [
        PBS_BASE + '/' + path + '/',
        PBS_TRANSLATE_BASE + '/' + path +
        '/?_x_tr_sl=auto&_x_tr_tl=en&_x_tr_hl=en',
    ]
    for url in urls:
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as response:
                page = response.read().decode('utf-8', 'replace')
            if not re.search(r'Checking your browser before accessing|/hcdn-cgi/jschallenge',
                             page, re.I):
                return page
        except urllib.error.URLError:
            continue
    raise RuntimeError('Pro Billiard Series page could not be loaded')


def pbs_path_from_url(url):
    match = re.match(
        r'https?://(?:www\.)?(?:probilliardseries\.com|'
        r'probilliardseries-com\.translate\.goog)/(event/[^"\'?#]+)', url, re.I)
    return match.group(1).strip('/') if match else None


def load_pbs_event(path):
    page = fetch_pbs_html(path)
    match = re.search(r'new\s+CueScore\.Tournament\(\s*(\d+)\s*\)', page)
    matches_path = path if match else None
    if not match:
        for href in re.findall(r'https?://[^"\']+', page):
            draw_path = pbs_path_from_url(html_mod.unescape(href))
            if not draw_path or not re.search(r'(?:^|/)matches[^/]*$', draw_path, re.I):
                continue
            draw_page = fetch_pbs_html(draw_path)
            match = re.search(r'new\s+CueScore\.Tournament\(\s*(\d+)\s*\)', draw_page)
            if match:
                matches_path = draw_path
                break
    return {
        'tournamentId': int(match.group(1)) if match else None,
        'pbsPath': path,
        'pbsMatchesPath': matches_path,
        'pbsUrl': PBS_BASE + '/' + path + '/',
    }


def load_pbs_events():
    page = fetch_pbs_html('events')
    roots = {}
    root_re = re.compile(
        r'href="https://(?:www\.)?(?:probilliardseries\.com|'
        r'probilliardseries-com\.translate\.goog)/(event/[^"?#]+)/?'
        r'(?:\?[^"#]*)?"', re.I)
    for match in root_re.finditer(page):
        path = match.group(1).strip('/')
        if len(path.split('/')) != 2:
            continue
        before = page[max(0, match.start() - 12000):match.start()]
        headings = re.findall(r'<h2[^>]*>(.*?)</h2>', before, re.I | re.S)
        dates = re.findall(
            r'jet-listing-dynamic-field__content">\s*([^<]*?\d{4})\s*<',
            before, re.I | re.S)
        if not headings:
            continue
        name = strip_tags(headings[-1])
        if re.search(r'events$', name, re.I):
            continue
        roots[path] = {
            'name': name,
            'dates': strip_tags(dates[-1]) if dates else None,
        }

    events = []
    seen = set()
    card_re = re.compile(
        r'data-url="https://(?:www\.)?probilliardseries\.com/'
        r'(event/[^"?#]+)/?"', re.I)
    cards = list(card_re.finditer(page))
    for index, match in enumerate(cards):
        path = match.group(1).strip('/')
        parts = path.split('/')
        if len(parts) < 3 or path in seen:
            continue
        end = cards[index + 1].start() if index + 1 < len(cards) else len(page)
        chunk = page[match.start():end]
        title = re.search(r'<h3[^>]*>(.*?)</h3>', chunk, re.I | re.S)
        date = re.search(
            r'jet-listing-dynamic-field__content">\s*([^<]*?\d{4})\s*<',
            chunk, re.I | re.S)
        if not title or not date:
            continue
        root = roots.get('/'.join(parts[:2]), {})
        seen.add(path)
        events.append({
            'path': path,
            'name': strip_tags(title.group(1)),
            'dates': strip_tags(date.group(1)),
            'series': root.get('name'),
            'seriesDates': root.get('dates'),
        })
    return events


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        if '/wnt/' in (self.path or ''):
            sys.stderr.write('  %s\n' % (fmt % args))

    def end_headers(self):
        # SimpleHTTPRequestHandler sends Last-Modified and nothing else — no
        # Cache-Control, no ETag — which leaves the browser free to invent a
        # freshness lifetime of its own. Chrome's guess is a tenth of the file's
        # age, so a file untouched for four months is held for eleven days
        # without ever asking again, and an edit to it appears to do nothing.
        # That is a full afternoon lost to a page that is not running the code
        # on disk, so a dev server should never allow it.
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        route = urllib.parse.urlparse(self.path)
        if not route.path.startswith('/wnt/') and not route.path.startswith('/pbs/'):
            return super().do_GET()
        try:
            if route.path == '/pbs/events':
                return self._json(cached('pbs-events', PBS_EVENTS_TTL,
                                         load_pbs_events))
            if route.path == '/pbs/event':
                raw = urllib.parse.parse_qs(
                    route.query).get('path', [''])[0]
                path = normalize_pbs_path(raw)
                if not path:
                    return self._json({'error': 'invalid PBS event path'}, 400)
                t0 = time.time()
                data = cached('pbs:' + path, PBS_RESOLVE_TTL,
                              lambda: load_pbs_event(path))
                sys.stderr.write('  %s: CueScore %s in %.1fs\n'
                                 % (path, data['tournamentId'], time.time() - t0))
                return self._json(data)
            if self.path == '/wnt/events':
                return self._json(cached('events', EVENTS_TTL, load_events))
            if self.path.startswith('/wnt/probe'):
                raw = urllib.parse.parse_qs(
                    urllib.parse.urlparse(self.path).query).get('slugs', [''])[0]
                slugs = [s for s in (x.strip() for x in raw.split(',')) if s][:PROBE_MAX]
                return self._json(probe_events(slugs))
            m = re.match(r'^/wnt/event/([A-Za-z0-9._-]+)/?$', self.path)
            if m:
                slug = m.group(1)
                t0 = time.time()
                data = cached('e:' + slug, EVENT_TTL, lambda: load_event(slug))
                sys.stderr.write('  %s: %d matches in %.1fs\n'
                                 % (slug, data['matchCount'], time.time() - t0))
                return self._json(data)
            self._json({'error': 'unknown route'}, 404)
        except WntAuthError as e:
            self._json({'error': 'auth', 'message': str(e)}, 401)
        except urllib.error.HTTPError as e:
            self._json({'error': 'upstream', 'message': '%s %s' % (e.code, e.reason)}, 502)
        except Exception as e:
            self._json({'error': 'proxy', 'message': repr(e)}, 500)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    try:
        session_id()
    except WntAuthError as e:
        sys.stderr.write('WARNING: %s — /wnt/* will 401\n' % e)
    print('PoolRadar  http://localhost:%d/' % port)
    print('US Open    http://localhost:%d/?wnt=us-open-pool-championship-2026' % port)
    Server(('127.0.0.1', port), Handler).serve_forever()
