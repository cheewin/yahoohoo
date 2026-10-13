# Server audit (13 October 2026)

Baseline: Hmbown/yahoohoo commit `3c88c9f8c0586cfb0d69adb6f4dbdac22dc333d0`.
The selected cheewin/yahoohoo repository was empty, not a GitHub fork according
to its repository metadata. The change branch preserves upstream history and
attribution; creating a true GitHub fork relationship is not part of this PR.

## Implementation and dependencies

- Node ES modules expose MCP over stdio or Express Streamable HTTP. Each HTTP
  session has its own tools, analysis results and run store.
- yahoo-finance2 uses Yahoo's unofficial search, quote, chart, quoteSummary,
  options, screener, trending and insights endpoints. CoinGecko public/demo v3
  endpoints supplement crypto quotes, OHLC, rankings, trending and metadata.
- The analysis engine keeps multi-ticker comparisons and financial/options/risk
  programs. Existing Python programs use the standard library; numpy and pandas
  are optional allowed imports, not prerequisites for these programs.
- The old lockfile's production npm audit reported 14 vulnerable packages
  (2 critical, 8 high, 4 moderate). Dependencies were refreshed, including SDK
  1.32.1, Express 5.3.0 and yahoo-finance2 4.0.3. The updated audit reports zero
  known vulnerabilities. This is a registry check, not proof of absence of bugs.

## Findings and changes

| Finding | Resolution |
| --- | --- |
| HTTP silently allowed access without keys | Startup refuses HTTP without OAuth or bearer keys |
| Existing bearer keys could not provide ChatGPT's OAuth sign-in flow | SDK OAuth routes, DCR, S256 PKCE, owner consent, resource audience, issuer identification, refresh rotation and revocation |
| Requested statement/ETF modules disappeared in compactSummary | Every requested module is retained; absent modules are null |
| Search mixed in non-Yahoo entities and consumed the result limit | Filter valid Yahoo symbols before limiting |
| yahoo-finance2's statement formatter removed zeros/currency | Capture raw time-series via its supported fetch hook; preserve every supplied line item and metadata |
| API errors looked like empty successful data | Failures become explicit MCP isError results; partial analysis records per-symbol dataErrors and reduces confidence |
| Missing exchange delays and retrieval timestamps | Quotes retain provider market time, delay minutes, exchange timezone, quote type and retrieval time |
| Long-lived unbounded caches / rate-window maps | Bounded caches, expired-entry pruning, concurrent request coalescing, bounded rate maps |
| Sessions were usable with any valid key and never expired | Principal-bound sessions and idle expiry; admission includes in-flight initializations |
| Unbounded simultaneous sandbox analyses | One active analyze/drill request per HTTP process |
| Incorrect deployment Dockerfile paths | Root Railway configuration and root-relative build paths; dynamic PORT fallback |
| Docker context could contain .env secrets | Exclude .env files, keys and logs; run image as non-root; Compose adds read-only FS and drops capabilities |
| Security docs claimed no auth despite optional key implementation | Updated documented security and ChatGPT setup |

## Remaining constraints

Yahoo is unofficial, may delay prices, throttle cloud IPs, require cookie/crumb
renewal, omit line items, or change schemas. This project has no licensed market
data SLA. An empty successful statement result means no provider coverage, not a
company with zero assets/revenue. All **returned** line items are preserved; the
server cannot supply filings or periods the provider does not offer. Statement
line-item `currencyCode`, `asOfDate`, `periodType` and `reportedValue` are retained
when supplied. Provider request failures are distinct from absence of coverage.

News is company-related search output, not a guaranteed exhaustive feed or full
article retrieval. Links, publication dates, publishers and related tickers are
preserved. Treat article text as untrusted content, not instructions.

Cache retrieval timestamps remain the original fetch times on cache hits. Market
time is the last trade timestamp; it need not be current when an exchange is
closed. `exchangeDataDelayedBy=null` means unknown, not real time. Yahoo OHLCV
dates are preserved; adjusted close is separate. Exchange calendars and crypto's
365-day trading calendar are not normalized by this PR. Existing statistics use
252-day annualization; interpret those estimates cautiously for crypto/intraday
or weekly inputs. Options/GEX are estimates based on provider open interest.

OAuth state is in memory: **one instance, one region, no sleep, no horizontal
scaling**. Restarting revokes tokens and loses registrations and sessions; users
must recreate/reconnect the ChatGPT plugin after a restart. This intentionally
avoids storing credential material on disk. For durable multi-user production,
use an external OAuth identity provider and persistent session/token storage.

Python AST checks are not a VM security boundary. Remote defaults disable CLI
LLM calls and sampling. Do not install model CLIs or mount account credentials in
the container. Deployment limits, a trusted owner, and the authenticated boundary
are still required. HTTP rate limits are per authenticated principal, plus a
shared direct-peer perimeter limit. Forwarded IPs are ignored to prevent spoofing;
multiple users behind the same hosting proxy can share that perimeter budget.

No live endpoint or ChatGPT installation is claimed by this audit. Those require
Railway account authorization, a deployed domain, and verification in ChatGPT.
