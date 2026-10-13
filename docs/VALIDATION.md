# Validation evidence — 13 October 2026

Verified in the cloud workspace, not on the user's computer:

| Check | Result |
| --- | --- |
| Upstream baseline `npm test` | 213 passed |
| Updated `npm run check` | Passed |
| Updated `npm test` | 248 passed, zero failed |
| `NODE_USE_ENV_PROXY=1 YAHOOHOO_TEST_LIVE=1 node --test test/live.test.js` | 7 live tests passed |
| `npm run smoke:sandbox` | `ok: true`, result sum 22/count 2 |
| `npm audit --omit=dev` | Zero known vulnerabilities in updated lockfile |
| Docker build (Node 22.23.3 / Debian Python) | Passed with TLS and package signatures enabled |
| Non-root container with read-only FS, tmpfs, capabilities dropped | Started and passed Docker health check |
| Unauthenticated `POST /mcp` | 401 as required |
| Full `npm run smoke:http` against container | Passed; MCP initialize/list/calls/session termination with live providers |
| HTTP OAuth tests | Discovery, DCR, owner consent, Origin/cookie checks, S256 PKCE, issuer success/error responses, audience, code replay, refresh rotation/replay, revocation, expiry |
| Hosted Railway HTTPS endpoint | Not deployed or verified; account authorization required |
| ChatGPT plugin installation/tool invocation | Not verified; requires deployed URL and account/workspace access |

The cloud machine uses an egress proxy. Initial live requests bypassed it and
failed DNS; Node's environment-proxy support resolved that failure. Initial
Docker builds could not resolve the proxy and needed the platform's public CA
and proxy address at build time. The successful build supplied a public CA via
BuildKit's optional `build_ca` mount, resolved the proxy hostname, and retained
TLS and apt signature checks. No platform certificate or proxy address is baked
into the production image. Ordinary Railway builds do not need these cloud-only
arguments. Container smoke testing likewise supplied the cloud proxy/public CA
at runtime; standard hosting uses direct networking.

Live tests cover AAPL stock, SPY ETF, ^GSPC index and BTC-USD crypto; OHLCV,
timestamps, exchange-delay field presence, company news, complete returned
annual financial statements, options, CoinGecko markets, and a bad symbol beside
a good one. Deterministic tests additionally cover quarterly/trailing statement
routing, unknown/new line items, real zero values, currency metadata, absent
coverage, missing prices/volumes, provider 429/auth/not-found/timeouts/schema
errors, filtering and partial errors. These tests demonstrate functionality at
the time run, not future provider availability or licensed market-data accuracy.
