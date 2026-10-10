# Western BCA entries proxy

The `wnt-proxy` Worker reads the `WBCA_TOKEN` secret and sends it to the
Western BCA API as a bearer token. The secret value must contain only the JWT.
Replace it after the Western BCA login expires.

## Deploy through Cloudflare Dashboard

1. Open **Workers & Pages → wnt-proxy → Edit code**.
2. Replace the Worker module with the contents of `worker/src/index.js`.
3. Click **Deploy**. The existing `WBCA_TOKEN` secret is available as `env.WBCA_TOKEN`.
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
to update `WBCA_TOKEN`. No token is returned in the JSON.

## Verify locally

```sh
node worker/test-wbca.mjs
```
