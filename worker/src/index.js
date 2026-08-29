/**
 * wnt-proxy — authenticated read-only proxy for wntlivescores.com.
 *
 * Everything on that site sits behind a login, including the JSON the live
 * scores page polls. This Worker holds a session so PoolRadar (a static page
 * with no backend) can read it, and exposes two routes:
 *
 *   GET /wnt/events        the event list, scraped (no JSON upstream exists)
 *   GET /wnt/event/<slug>  every stage and group of one event, merged
 *
 * Secrets (set with `wrangler secret put`, never in this file or wrangler.toml):
 *   WNT_EMAIL, WNT_PASSWORD  credentials to log in with
 *   WNT_SESSION              optional raw wnt.live.sid, overrides the above
 *
 * Mirrors wnt-dev-proxy.py route for route so local and deployed behave alike.
 */

const BASE = 'https://www.wntlivescores.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// PoolRadar and TournamentPerf are both served from the same Pages origin, so
// one entry covers both.
const ALLOWED_ORIGINS = ['https://slyfox3.github.io'];

function originAllowed(origin) {
  return ALLOWED_ORIGINS.includes(origin);
}

// Upstream polls itself every 33s, so 20s is fresh without adding load.
const EVENT_TTL = 20;
const EVENTS_TTL = 600;

const MAX_STAGES = 6;
const MAX_GROUPS = 32;

class AuthError extends Error {}

// Cached per isolate. Isolates are short-lived and numerous, but the edge cache
// in front of these routes means a login costs far less than one per request.
let sessionCookie = null;

async function login(env) {
  if (env.WNT_SESSION) return env.WNT_SESSION;
  if (!env.WNT_EMAIL || !env.WNT_PASSWORD) {
    throw new AuthError('No credentials. Set WNT_EMAIL and WNT_PASSWORD, or WNT_SESSION.');
  }
  const res = await fetch(BASE + '/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: new URLSearchParams({ username: env.WNT_EMAIL, password: env.WNT_PASSWORD }),
    redirect: 'manual',
  });
  const cookies = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  for (const c of cookies) {
    const m = /wnt\.live\.sid=([^;]+)/.exec(c);
    // A failed login still hands back a session cookie, just an anonymous one,
    // so this is not proof of success — wntFetch decides that on the next 302.
    if (m) return m[1];
  }
  throw new AuthError('Login returned no session cookie.');
}

async function wntFetch(path, env, retry = true) {
  if (!sessionCookie) sessionCookie = await login(env);
  const res = await fetch(BASE + path, {
    headers: {
      'User-Agent': UA,
      'Cookie': 'wnt.live.sid=' + sessionCookie,
      'X-Requested-With': 'XMLHttpRequest',
    },
    redirect: 'manual',
  });
  // An expired or anonymous session bounces to /login rather than 401ing.
  if (res.status >= 300 && res.status < 400) {
    sessionCookie = null;
    if (retry) return wntFetch(path, env, false);
    throw new AuthError('WNT rejected the session. Check WNT_EMAIL / WNT_PASSWORD.');
  }
  if (!res.ok) throw new Error('WNT returned ' + res.status + ' for ' + path);
  return res.text();
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

async function loadEvents(env) {
  const html = await wntFetch('/events', env);
  const events = [];
  let section = null;
  // Cards appear in document order beneath "Upcoming events" / "Past events".
  for (const chunk of html.split(/(?=<div class="col-12 events-time-title">)/)) {
    const head = /events-time-title">([^<]*)</.exec(chunk);
    if (head) section = stripTags(head[1]);
    const re = /onclick="location\.href='events\/([^']+)';"([\s\S]*?)(?=<div class="col">|$)/g;
    let card;
    while ((card = re.exec(chunk)) !== null) {
      const [, slug, body] = card;
      const title = /event-title[^>]*>([\s\S]*?)<\/h3>/.exec(body);
      const date = /icon-calendar[\s\S]*?<span>([\s\S]*?)<\/span>/.exec(body);
      const locBlock = /event-location[\s\S]*?<\/div>\s*<\/div>/.exec(body);
      const places = [];
      if (locBlock) {
        const pr = /<div class="text-center">([^<]*)<\/div>/g;
        let p;
        // stripTags rather than a bare trim: these two were the only scraped
        // fields that skipped it, which is why a fifth of the venues came back
        // as "Harrah&#39;s Resort" while the name and dates beside them were
        // clean — and why /wnt/events and /wnt/event/<slug> disagreed about the
        // spelling of the same venue.
        while ((p = pr.exec(locBlock[0])) !== null) places.push(stripTags(p[1]));
      }
      events.push({
        slug,
        // Titles end in a decorative "." span: "US Open 2026<span>.</span>"
        name: title ? stripTags(title[1]).replace(/[\s.]+$/, '') : slug,
        dates: date ? stripTags(date[1]) : null,
        venue: places[0] || null,
        city: places[1] || null,
        live: body.includes('Live Scores'),
        section,
      });
    }
  }
  return events;
}

async function eventMeta(slug, env) {
  const html = await wntFetch('/events/' + slug, env);
  const meta = {
    slug,
    name: slug.replace(/-/g, ' '),
    venue: null, city: null, dates: null, prize: null,
  };
  // The event page shows its name only as a logo image, so the text has to
  // come from the event-list card.
  try {
    const found = (await loadEvents(env)).find((e) => e.slug === slug);
    if (found) meta.name = found.name;
  } catch (e) { /* name is cosmetic; keep the slug fallback */ }

  for (const [label, key] of [['Date', 'dates'], ['Venue', 'venue'],
    ['Location', 'city'], ['Prize fund', 'prize']]) {
    const m = new RegExp('>\\s*' + label + '\\s*</span>\\s*</div>\\s*<span>([\\s\\S]*?)</span>').exec(html);
    if (m) meta[key] = stripTags(m[1]);
  }
  return meta;
}

async function loadEvent(slug, env) {
  const stages = [];
  // Walk stage 1..N and group 1..M, stopping at the first empty reply. An
  // absent stage/group answers {"tmp":0,"matches":[]}, so the shape of an
  // event is discoverable without hardcoding it.
  for (let stage = 1; stage <= MAX_STAGES; stage++) {
    const groups = [];
    for (let group = 1; group <= MAX_GROUPS; group++) {
      const raw = await wntFetch(`/events/${slug}/group-matches/${stage}/${group}/0`, env);
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        throw new AuthError(`Non-JSON reply for stage ${stage} group ${group}`);
      }
      if (!data.matches || data.matches.length === 0) break;
      groups.push({
        group,
        tmp: data.tmp,
        publishScheduledDate: data.publishScheduledDate,
        publishScheduledTime: data.publishScheduledTime,
        matches: data.matches,
      });
    }
    if (groups.length === 0) break;
    stages.push({ stage, groups });
  }

  const meta = await eventMeta(slug, env);
  meta.stages = stages;
  meta.matchCount = stages.reduce(
    (n, s) => n + s.groups.reduce((k, g) => k + g.matches.length, 0), 0);
  return meta;
}

function corsHeaders(origin) {
  const h = { 'Content-Type': 'application/json' };
  if (origin && originAllowed(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Vary'] = 'Origin';
  }
  return h;
}

function json(obj, status, origin, ttl) {
  const h = corsHeaders(origin);
  if (ttl) h['Cache-Control'] = 'public, max-age=' + ttl;
  return new Response(JSON.stringify(obj), { status, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      const h = corsHeaders(origin);
      h['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
      h['Access-Control-Max-Age'] = '86400';
      return new Response(null, { status: 204, headers: h });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method' }, 405, origin);
    }
    // Browsers always send Origin cross-site, so this keeps other sites from
    // spending our account. It cannot stop a direct client that omits the
    // header — the edge cache and the throwaway account are what limit that.
    if (origin && !originAllowed(origin)) {
      return new Response(JSON.stringify({ error: 'origin not allowed' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Reports which credential the Worker can see and whether it still works.
    // Never echoes a secret — only its length and prefix, which is enough to
    // spot the usual damage: whitespace, quotes, or a decoded %3A.
    if (url.pathname === '/wnt/health') {
      const present = {
        WNT_SESSION: !!env.WNT_SESSION,
        WNT_EMAIL: !!env.WNT_EMAIL,
        WNT_PASSWORD: !!env.WNT_PASSWORD,
      };
      const out = {
        credential: present.WNT_SESSION ? 'WNT_SESSION'
          : (present.WNT_EMAIL && present.WNT_PASSWORD ? 'WNT_EMAIL/WNT_PASSWORD' : 'none'),
        present,
        envKeys: Object.keys(env).sort(),
      };
      if (env.WNT_SESSION) {
        const v = env.WNT_SESSION;
        out.sessionShape = {
          length: v.length,
          startsWith: v.slice(0, 4),
          looksUrlEncoded: v.includes('%3A'),
          hasWhitespace: /\s/.test(v),
          hasQuotes: /['"]/.test(v),
          hasCookiePrefix: v.includes('wnt.live.sid'),
        };
      }
      try {
        sessionCookie = null; // force a fresh read of the env credential
        const raw = await wntFetch('/events/us-open-pool-championship-2026/group-matches/1/1/0', env);
        const parsed = JSON.parse(raw);
        out.ok = true;
        out.upstreamMatches = (parsed.matches || []).length;
      } catch (e) {
        out.ok = false;
        out.error = String(e && e.message || e);
      }
      return json(out, out.ok ? 200 : 503, origin);
    }

    // Cache on path alone; the payload never varies by caller.
    const cacheKey = new Request('https://wnt-proxy.invalid' + url.pathname, { method: 'GET' });
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) {
      const h = corsHeaders(origin);
      h['X-Cache'] = 'HIT';
      return new Response(hit.body, { status: hit.status, headers: h });
    }

    try {
      let payload;
      let ttl;
      if (url.pathname === '/wnt/events') {
        payload = await loadEvents(env);
        ttl = EVENTS_TTL;
      } else {
        const m = /^\/wnt\/event\/([A-Za-z0-9._-]+)\/?$/.exec(url.pathname);
        if (!m) return json({ error: 'unknown route' }, 404, origin);
        payload = await loadEvent(m[1], env);
        ttl = EVENT_TTL;
      }
      const body = JSON.stringify(payload);
      ctx.waitUntil(cache.put(cacheKey, new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + ttl },
      })));
      const h = corsHeaders(origin);
      h['Cache-Control'] = 'public, max-age=' + ttl;
      h['X-Cache'] = 'MISS';
      return new Response(body, { status: 200, headers: h });
    } catch (e) {
      if (e instanceof AuthError) {
        return json({ error: 'auth', message: e.message }, 401, origin);
      }
      return json({ error: 'proxy', message: String(e && e.message || e) }, 502, origin);
    }
  },
};
