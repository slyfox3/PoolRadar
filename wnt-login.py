#!/usr/bin/env python3
"""Log in to wntlivescores.com, write .wnt-session, and push it to the Worker.

The alternative is opening DevTools, finding the right request, copying it as a
curl command and fishing wnt.live.sid out of it by hand — which is how the
cookie in this repo used to be refreshed, and which went wrong the obvious way:
a paste that clipped the leading "s" produced a session that looked plausible,
wrote cleanly, and failed on every request.

So this asks for the two things a browser would ask for, does what the login
form does, checks the answer before writing anything, and then puts the same
session on the Worker — because fresh locally and stale in production is the
more confusing half of the problem.

    ./wnt-login.py               log in, write the file, upload, verify both
    ./wnt-login.py --no-upload   local only
    ./wnt-login.py --check       test the session on disk AND on the Worker

The upload is not trusted on its word. wrangler reporting success only means
the secret was stored, not that the Worker authenticates with it — so after
uploading it asks the Worker to fetch a real bracket and to answer a probe for
a slug nobody has ever requested, which cannot come from the edge cache.

The password is read with getpass: never echoed, never a shell argument, never
in history, never printed, and never stored. It is typed every time on purpose.

Touch ID is not offered because it is not reachable on this machine, and the
reason is worth recording so nobody tries again. Gating a keychain item on
biometrics needs an access control, which moves the item into the data
protection keychain, which requires the calling process to be signed with a
keychain-access-groups entitlement. A compiled helper could carry one, but
Santa kills locally-built binaries at exec — a two-line C program dies the same
way. Python survives Santa and can reach the whole Security framework through
ctypes, but has no entitlement: any access control at all, biometric or not,
returns -34018. Both roads need a binary that is Santa-approved AND entitled,
which is an IT request rather than a code change.

The dev proxy needs no restart afterwards: it reads .wnt-session per request.
"""

import argparse
import getpass
import hashlib
import http.cookiejar
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://www.wntlivescores.com'
SESSION_FILE = os.path.join(ROOT, '.wnt-session')
WORKER_DIR = os.path.join(ROOT, 'worker')
# The same host the three pages fall back to when they are not on localhost.
WORKER_BASE = 'https://wnt-proxy.slyfox3.workers.dev'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')

# Any slug will do — the point is the status code, not the event. An
# authenticated request answers 200 with JSON even for a slug that does not
# exist; an unauthenticated one is bounced to /login with a 302. That makes the
# check independent of which events happen to be on the site this month.
PROBE_PATH = '/events/__auth_probe__/group-matches/1/1/0'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """The 302 IS the answer here, so it must not be followed.

    urllib chases redirects by default and would hand back the login page with
    a 200, which reads as success.
    """

    def redirect_request(self, *a, **kw):
        return None


def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar), NoRedirect()), jar


def sid_from(jar):
    for c in jar:
        if c.name == 'wnt.live.sid':
            return c.value
    return None


def shape(sid):
    """Enough to spot a bad paste without putting the secret on screen."""
    return (f'{len(sid)} chars, starts {sid[:4]!r}'
            + ('' if sid.startswith(('s%3A', 's:')) else '  <-- does not look like a session'))


def works(sid):
    """True if this cookie is actually logged in."""
    req = urllib.request.Request(BASE + PROBE_PATH, headers={
        'User-Agent': UA,
        'Cookie': 'wnt.live.sid=' + sid,
        'X-Requested-With': 'XMLHttpRequest',
    })
    op, _ = opener()
    try:
        res = op.open(req, timeout=30)
    except urllib.error.HTTPError as e:
        # 302 to /login is the site saying no.
        return False, f'HTTP {e.code}' + (' (bounced to /login)' if e.code in (301, 302) else '')
    if res.status != 200:
        return False, f'HTTP {res.status}'
    body = res.read(200).decode('utf-8', 'replace')
    if '"matches"' not in body:
        return False, 'answered 200 but not with the JSON we expect'
    return True, 'authenticated'


def login(username, password):
    op, jar = opener()

    # The site issues an anonymous session before you submit anything, and the
    # login is applied to it — so it has to be picked up first and carried.
    # This is also why a cookie coming back from the POST proves nothing on its
    # own, and why works() runs afterwards regardless.
    op.open(urllib.request.Request(BASE + '/login', headers={'User-Agent': UA}), timeout=30)

    data = urllib.parse.urlencode({'username': username, 'password': password}).encode()
    req = urllib.request.Request(BASE + '/login', data=data, headers={
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': BASE,
        'Referer': BASE + '/login',
    })
    try:
        op.open(req, timeout=30)
    except urllib.error.HTTPError as e:
        # A successful login redirects. Failure re-renders the form with a 200,
        # which is the opposite of what you would guess.
        if e.code not in (301, 302, 303):
            raise
    return sid_from(jar)


def upload(sid):
    """Put the same session on the Worker.

    Piped on stdin rather than passed as an argument, so it never shows up in a
    process listing. --offline because wrangler is already in the npx cache and
    the registry has 503'd at the wrong moment before now.
    """
    cmd = ['npx', '--offline', 'wrangler', 'secret', 'put', 'WNT_SESSION']
    try:
        r = subprocess.run(cmd, cwd=WORKER_DIR, input=sid + '\n',
                           capture_output=True, text=True, timeout=180)
    except FileNotFoundError:
        return False, 'npx is not on PATH'
    except subprocess.TimeoutExpired:
        return False, 'wrangler timed out'
    if r.returncode != 0:
        tail = [l for l in (r.stderr or r.stdout).strip().splitlines() if l.strip()]
        return False, tail[-1] if tail else f'exit {r.returncode}'
    return True, 'uploaded'


def _get_json(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode('utf-8', 'replace'))


def verify_worker(sid, tries=6, pause=3):
    """Prove the Worker is really serving on the session we just uploaded.

    Three things, because each rules out a different way of being wrong:

      health          answers before the cache block and fetches a bracket, so
                      a non-zero upstreamMatches means it authenticated now
      the digest      the Worker reports a truncated SHA-256 of its secret, so
                      we can prove it holds THIS session and not the previous
                      one. Length and prefix cannot do that: every session
                      starts s%3A, two are often the same length, and a session
                      replaced before it expired is usually still valid — so
                      every other check here would pass on the old one
      a nonce probe   a slug nobody has ever asked about cannot be a cache hit,
                      so an answer can only come from a live upstream call

    That last one is the reason this exists at all: /wnt/events would answer 200
    from the edge cache with a dead session behind it, which is exactly how a
    stale deploy once looked healthy.

    Retried, because a secret update takes a moment to reach every isolate.
    """
    want = hashlib.sha256(sid.encode()).hexdigest()[:12]
    last = 'no attempt made'
    for attempt in range(1, tries + 1):
        try:
            h = _get_json(f'{WORKER_BASE}/wnt/health')
            shape_ = h.get('sessionShape') or {}
            got = shape_.get('sha12')
            if not h.get('ok'):
                last = f"health says ok={h.get('ok')}"
            elif got is None:
                # An older Worker build. Length and prefix are all it offers,
                # and they cannot tell one session from another of the same
                # length — so say the check is weak rather than imply it passed.
                if shape_.get('length') != len(sid) or shape_.get('startsWith') != sid[:4]:
                    last = 'the Worker holds a different secret'
                else:
                    return True, ('worker has no sha12 — cannot prove it is THIS session; '
                                  'deploy the Worker to make this check exact')
            elif got != want:
                # The usual cause is propagation, which the retry covers. If it
                # persists, the upload did not land.
                last = f'the Worker is still serving a different session ({got} != {want})'
            elif not h.get('upstreamMatches'):
                last = 'the new session is in place but fetched no matches'
            else:
                nonce = '__verify_' + os.urandom(4).hex() + '__'
                probe = _get_json(f'{WORKER_BASE}/wnt/probe?slugs={nonce}')
                if nonce not in probe:
                    # An empty reply is the probe being bounced to /login and
                    # omitting the slug rather than guessing "no bracket".
                    last = 'a fresh probe came back unanswered — upstream refused it'
                else:
                    return True, (f"serving this exact session (sha {want}), "
                                  f"{h['upstreamMatches']} matches upstream, "
                                  f"fresh probe answered")
        except Exception as e:
            last = str(e)
        if attempt < tries:
            time.sleep(pause)
    return False, last


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--check', action='store_true',
                    help='only test the session already in .wnt-session')
    ap.add_argument('--no-upload', action='store_true',
                    help='write the file but do not push it to the Worker')
    args = ap.parse_args()

    if args.check:
        if not os.path.exists(SESSION_FILE):
            sys.exit('No .wnt-session to check.')
        sid = open(SESSION_FILE).read().strip()
        ok, why = works(sid)
        print(f'  local  .wnt-session: {shape(sid)}')
        print(f'         {"works" if ok else "DEAD"} — {why}')
        good, wwhy = verify_worker(sid, tries=1)
        print(f'  worker {WORKER_BASE}')
        print(f'         {"works" if good else "DEAD"} — {wwhy}')
        return 0 if (ok and good) else 1

    # A password prompt needs a terminal, and several things that look like one
    # are not: Claude Code's "!" shell, a pipe, a CI step. Without this the
    # first input() raises EOFError and prints a traceback that says nothing
    # about the actual problem.
    if not sys.stdin.isatty():
        sys.exit('This needs a real terminal — it asks for a password.\n'
                 'Run it from Terminal or iTerm:\n'
                 f'    cd {ROOT} && ./wnt-login.py\n'
                 'Everything else here works without one, e.g. --check.')

    print('Logging in to wntlivescores.com. The password is not echoed, not a')
    print('shell argument, and not stored anywhere.\n')
    username = input('  email    : ').strip()
    if not username:
        sys.exit('An email is needed.')
    password = getpass.getpass('  password : ')
    if not password:
        sys.exit('A password is needed.')

    print('\n  logging in…')
    try:
        sid = login(username, password)
    except Exception as e:
        sys.exit(f'  login request failed: {e}')
    if not sid:
        sys.exit('  no session cookie came back at all — the login form may have changed.')

    # Checked before writing, so a wrong password cannot replace a session that
    # still works. The site hands out an anonymous cookie either way.
    print('  checking whether it is actually logged in…')
    ok, why = works(sid)
    if not ok:
        sys.exit(f'  that session is not authenticated ({why}).\n'
                 f'  Wrong password, most likely. Nothing was changed.')

    with open(SESSION_FILE, 'w') as fh:
        fh.write(sid + '\n')
    os.chmod(SESSION_FILE, 0o600)
    print(f'  wrote .wnt-session — {shape(sid)}')

    if args.no_upload:
        print('\n  skipped the Worker (--no-upload). By hand:')
        print('    cd worker && npx --offline wrangler secret put WNT_SESSION < ../.wnt-session')
        return 0

    print('  uploading to the Worker…')
    sent, why = upload(sid)
    if not sent:
        print(f'  could not upload: {why}')
        print('  the local file is fine; retry the Worker with:')
        print('    cd worker && npx --offline wrangler secret put WNT_SESSION < ../.wnt-session')
        return 1
    print('  Worker secret updated — verifying it actually serves on it…')
    good, why = verify_worker(sid)
    if not good:
        print(f'  the Worker is NOT working on the new session: {why}')
        print('  the local file is fine. Check by hand:')
        print(f'    curl -s {WORKER_BASE}/wnt/health | python3 -m json.tool')
        return 1
    print(f'  verified — {why}\n')
    print('  Both sides are on the same session. The dev proxy needs no restart.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
