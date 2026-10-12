# Western BCA entries proxy

Set `WBCA_REFRESH_TOKEN` in the Cloudflare Dashboard using the WBCA website's
Local Storage `refreshToken` value. `WBCA_TOKEN` is no longer required.
The Worker calls `/user/refresh-token` to obtain an access token automatically,
keeps it in isolate memory, and renews it a minute before expiry or retries
once after an entries request returns 401/403. A new isolate obtains its own
access token. No KV binding is required and tokens never enter public edge cache.

This follows the site's reusable refresh-token flow. If the refresh token
itself expires or is revoked, sign in again and replace `WBCA_REFRESH_TOKEN`.
Legacy deployments with only `WBCA_TOKEN` still work, but require manual renewal.

## Check the deployed token

Check all known credentials together:

```text
https://wnt-proxy.slyfox3.workers.dev/health
```

The response is `{ ok, checks: { wnt, wbca } }`. Both upstreams are checked
on every request; one failed check does not hide the other result. HTTP 200
means all checks passed, while HTTP 503 means at least one failed.

Check WBCA alone:

```text
https://wnt-proxy.slyfox3.workers.dev/wbca/health
```

This route calls the Western BCA API directly with `limit=1` on every request,
bypassing the entries cache. HTTP 200 with `ok: true` confirms the token works.
HTTP 503 with `ok: false` reports a missing/rejected token (`error: "auth"`)
or an upstream failure (`error: "upstream"`). The response includes whether
`WBCA_REFRESH_TOKEN` and legacy `WBCA_TOKEN` are present, but never their values
or player records. In refresh mode, health actually requests a new access token
before probing entries, so a cached access token cannot conceal a rejected
refresh token. Responses use
`Cache-Control: no-store`. `/wnt/health` remains the WNT credential check.

Every check includes `expiresAt` (UTC ISO timestamp) and `expiresInSeconds`.
WBCA's JWT `exp` claim provides this metadata when present. An opaque WNT
session, missing token, or unrecognised expiry returns `null` for both fields.
Expiry metadata does not establish validity; only the live upstream check does.
WBCA also returns `refreshExpiresAt` and `refreshExpiresInSeconds` when its
refresh token has a JWT `exp`. These describe the refresh token; `expiresAt`
and `expiresInSeconds` describe the current access token.

Whenever a new token/credential secret is added to Cloudflare, add its
corresponding checking function and uncached health route as well. Register it
in `TOKEN_HEALTH_CHECKS` so the aggregate `/health` route includes it.

## Deploy through Cloudflare Dashboard

1. Open **Workers & Pages → wnt-proxy → Edit code**.
2. Replace the Worker module with the contents of `worker/src/index.js`.
3. Click **Deploy**. The existing `WBCA_REFRESH_TOKEN` secret is available as `env.WBCA_REFRESH_TOKEN`.
4. Open the endpoint below to verify that it returns JSON.

```text
https://wnt-proxy.slyfox3.workers.dev/wbca/entries?page=1&limit=50
```

The response has `entries`, `total`, `page`, and `limit`. Each entry contains
`eventName`, `division`, `divisionType`, `teamName`, `players`, and
`alternatePlayers`. Each player has `firstName`, `lastName`, `fargoRate`,
and `robustness`. Responses are cached for 60 seconds.

This route uses the existing Worker's public access model. Anyone who can
call the endpoint can read these returned entry fields. CORS allows the
PoolRadar origin; it does not authenticate callers.

### Search and pagination

`page` starts at 1. `limit` defaults to 50 and can be at most 100.
`search` uses the source API's filters and is limited to 500 characters:

```js
const query = new URLSearchParams({ search: 'general:Chia,year:2026', page: 1, limit: 50 });
const response = await fetch('https://wnt-proxy.slyfox3.workers.dev/wbca/entries?' + query);
const data = await response.json();
```

A missing, expired, or unauthorised token returns HTTP 401 with a message
to update `WBCA_REFRESH_TOKEN` (or `WBCA_TOKEN` in legacy mode). No token is
returned in the JSON.

## Verify locally

```sh
node worker/test-wbca.mjs
node worker/test-health.mjs
node worker/test-wbca-refresh.mjs
```
