# Yahoohoo

An MCP server that gives AI assistants real market-data analysis capabilities. It connects to Yahoo Finance, runs numerical computations in a sandboxed Python subprocess, and optionally uses the host LLM for recursive reasoning — all without needing its own API key.

```text
MCP Host (Claude, Codex, ChatGPT, etc.)
  ├─ calls yahoohoo tools
  ├─ optionally serves sampling back to Yahoohoo
  ▼
Yahoohoo MCP Server (Node.js)
  ├─ Yahoo Finance adapter (search, quotes, OHLCV, options, fundamentals)
  ├─ intent classifier → program selector
  ├─ recursive analysis engine (comparison, risk, options, fundamentals)
  └─ Python sandbox (numpy/pandas, resource limits, JSON-only output)
```

Yahoohoo does **not** own the model. The MCP host provides the reasoning layer. When the host supports MCP sampling, Yahoohoo uses it for recursive decomposition and synthesis. When it doesn't, everything still works via deterministic heuristics.

---

## Quick Start

```bash
# Install (Node 22+, Python 3 required)
npm install

# Stdio mode (local MCP clients)
node src/index.js --transport stdio

# HTTP mode (remote connectors, ChatGPT)
node src/index.js --transport http
# → http://127.0.0.1:3434/mcp
# → http://127.0.0.1:3434/health
```

### Docker

```bash
docker build -t yahoohoo .
docker run --rm -p 3434:3434 yahoohoo
```

Or with docker-compose:

```bash
docker compose up
```

### Host Configuration

**Claude Code:**
```bash
claude mcp add --transport stdio yahoohoo -- node /path/to/yahoohoo/src/index.js --transport stdio
```

**Codex:**
```bash
codex mcp add yahoohoo -- node /path/to/yahoohoo/src/index.js --transport stdio
```

**ChatGPT:** Run in HTTP mode behind HTTPS, point the connector at `https://<host>/mcp`.

---

## Tools Reference

### `yahoo_search`

Search Yahoo Finance instruments by name, symbol, or keyword.

| Parameter | Type | Required | Default |
|-----------|------|----------|---------|
| `query` | string | yes | — |
| `limit` | number | no | 8 |

```json
// yahoo_search({ "query": "treasury bond etf" })
[
  { "symbol": "TLT", "shortname": "iShares 20+ Year Treasury Bond", "exchange": "NGM", "quoteType": "ETF", "score": 20727 },
  { "symbol": "IEF", "shortname": "iShares 7-10 Year Treasury Bond", "exchange": "NGM", "quoteType": "ETF", "score": 20042 },
  { "symbol": "SGOV", "shortname": "iShares 0-3 Month Treasury Bond", "exchange": "NYQ", "quoteType": "ETF", "score": 20029 },
  { "symbol": "SHY", "shortname": "iShares 1-3 Year Treasury Bond", "exchange": "NGM", "quoteType": "ETF", "score": 20009 },
  { "symbol": "SHV", "shortname": "iShares 0-1 Year Treasury Bond", "exchange": "NYQ", "quoteType": "ETF", "score": 20009 },
  { "symbol": "GOVT", "shortname": "iShares U.S. Treasury Bond ETF", "exchange": "BTS", "quoteType": "ETF", "score": 20008 }
]
```

### `yahoo_quote`

Fetch current quote snapshots for one or more symbols.

| Parameter | Type | Required |
|-----------|------|----------|
| `symbols` | string[] | yes (max 20) |

```json
// yahoo_quote({ "symbols": ["QQQ", "IWM", "TLT", "USO"] })
{
  "QQQ": {
    "symbol": "QQQ",
    "shortName": "Invesco QQQ Trust, Series 1",
    "currency": "USD",
    "exchange": "NasdaqGM",
    "regularMarketPrice": 599.75,
    "regularMarketChange": -9.16,
    "regularMarketChangePercent": -1.50,
    "fiftyTwoWeekHigh": 637.01,
    "fiftyTwoWeekLow": 402.39,
    "marketCap": 235761729536,
    "trailingPE": 32.84,
    "averageDailyVolume3Month": 59085416
  },
  "IWM": {
    "symbol": "IWM",
    "shortName": "iShares Russell 2000 ETF",
    "regularMarketPrice": 250.89,
    "regularMarketChangePercent": -2.29,
    "fiftyTwoWeekHigh": 271.6,
    "fiftyTwoWeekLow": 171.73,
    "marketCap": 70512631808,
    "trailingPE": 18.33
  },
  "TLT": {
    "symbol": "TLT",
    "shortName": "iShares 20+ Year Treasury Bond",
    "regularMarketPrice": 88.46,
    "regularMarketChangePercent": -0.37,
    "fiftyTwoWeekHigh": 94.09,
    "fiftyTwoWeekLow": 83.3,
    "marketCap": 9704061952
  },
  "USO": {
    "symbol": "USO",
    "shortName": "United States Oil Fund",
    "regularMarketPrice": 108.77,
    "regularMarketChangePercent": 12.94,
    "fiftyTwoWeekHigh": 109.95,
    "fiftyTwoWeekLow": 60.67,
    "marketCap": 12954506240,
    "trailingPE": 32.91
  }
}
```

### `yahoo_historical`

Fetch historical OHLCV bars.

| Parameter | Type | Required | Default |
|-----------|------|----------|---------|
| `symbol` | string | yes | — |
| `from` | string (YYYY-MM-DD) | no | 180 days ago |
| `to` | string (YYYY-MM-DD) | no | today |
| `interval` | enum | no | `1d` |

Valid intervals: `1m`, `2m`, `5m`, `15m`, `30m`, `60m`, `90m`, `1h`, `1d`, `5d`, `1wk`, `1mo`, `3mo`.

```json
// yahoo_historical({ "symbol": "QQQ", "from": "2025-09-06", "to": "2026-03-06" })
// Returns 125 daily OHLCV bars:
[
  { "date": "2025-09-08T13:30:00.000Z", "open": 578.37, "high": 580.84, "low": 577.77, "close": 578.87, "volume": 46371400, "adjClose": 577.46 },
  { "date": "2025-09-09T13:30:00.000Z", "open": 579.67, "high": 580.94, "low": 577.04, "close": 580.51, "volume": 44007600, "adjClose": 579.09 },
  "... 121 more bars ...",
  { "date": "2026-03-04T14:30:00.000Z", "open": 604.16, "high": 612.88, "low": 603.43, "close": 610.75, "volume": 70943900, "adjClose": 610.75 },
  { "date": "2026-03-05T14:30:00.000Z", "open": 607.40, "high": 612.76, "low": 602.26, "close": 608.91, "volume": 89602400, "adjClose": 608.91 }
]
```

### `yahoo_quote_summary`

Fetch company profile and valuation/fundamental summary modules.

| Parameter | Type | Required | Default |
|-----------|------|----------|---------|
| `symbol` | string | yes | — |
| `modules` | string[] | no | price, summaryDetail, financialData, defaultKeyStatistics, calendarEvents, assetProfile |

```json
// yahoo_quote_summary({ "symbol": "AAPL" })
// Returns nested objects for each module. Key fields:
{
  "price": {
    "regularMarketPrice": 257.46,
    "marketCap": 3784127807488,
    "shortName": "Apple Inc."
  },
  "summaryDetail": {
    "trailingPE": 32.55,
    "forwardPE": 27.72,
    "dividendYield": 0.004,
    "beta": 1.116,
    "fiftyTwoWeekHigh": 288.62,
    "fiftyTwoWeekLow": 169.21,
    "fiftyDayAverage": 264.56
  },
  "financialData": {
    "currentPrice": 257.46,
    "targetMeanPrice": 292.15,
    "recommendationKey": "buy",
    "numberOfAnalystOpinions": 40,
    "totalRevenue": 435617005568,
    "revenueGrowth": 0.157,
    "profitMargins": 0.27,
    "returnOnEquity": 1.52,
    "debtToEquity": 102.63,
    "freeCashflow": 106312753152
  },
  "defaultKeyStatistics": {
    "enterpriseValue": 3844955963392,
    "forwardPE": 27.72,
    "trailingEps": 7.91,
    "forwardEps": 9.29,
    "priceToBook": 42.92,
    "sharesOutstanding": 14681140000,
    "heldPercentInstitutions": 0.652
  },
  "calendarEvents": {
    "earnings": { "earningsDate": ["2026-04-30T21:00:00.000Z"], "earningsAverage": 1.96 }
  },
  "assetProfile": {
    "sector": "Technology",
    "industry": "Consumer Electronics",
    "fullTimeEmployees": 150000,
    "city": "Cupertino",
    "country": "United States"
  }
}
```

### `yahoo_options`

Fetch an option chain snapshot.

| Parameter | Type | Required | Default |
|-----------|------|----------|---------|
| `symbol` | string | yes | — |
| `date` | string (YYYY-MM-DD) | no | nearest expiry |

```json
// yahoo_options({ "symbol": "QQQ" })
{
  "underlyingSymbol": "QQQ",
  "expirationDates": [
    "2026-03-09", "2026-03-10", "2026-03-11", "... 25 more ...", "2028-06-16"
  ],
  "strikes": [500, 505, 510, "...", 609],
  "calls": [],
  "puts": [],
  "quote": { "regularMarketPrice": 599.75, "fiftyTwoWeekHigh": 637.01, "..." : "..." }
}
```

> **Note:** The `calls` and `puts` arrays are consistently empty due to a known upstream issue in yahoo-finance2. Expiration dates (28 dates) and strikes (50 strikes) are returned correctly, and the underlying quote is complete. This affects the `yahoohoo_analyze` options intent as well — IV skew and put/call ratios will be null.

### `yahoohoo_analyze`

The main recursive analysis tool. Fetches data, runs sandboxed computation, optionally decomposes into child analyses, and produces a narrative summary.

| Parameter | Type | Required | Default |
|-----------|------|----------|---------|
| `query` | string | yes | — |
| `symbols` | string[] | no (max 6) | inferred from query |
| `benchmark` | string | no | SPY (when relevant) |
| `from` | string | no | 180 days ago |
| `to` | string | no | today |
| `interval` | enum | no | auto-selected |
| `reasoningMode` | `auto` / `sampling` / `heuristic` | no | `auto` |
| `includeFundamentals` | boolean | no | false |
| `includeOptions` | boolean | no | false |
| `maxDepth` | number (0-4) | no | 2 |

---

## Recursive Analysis Engine

### How it works

1. **Intent classification** — The query and symbols are classified into one of: `comparison`, `options`, `fundamentals`, `risk`, `macro`, `portfolio`, or `general`.

2. **Program selection** — Each intent maps to a specialized Python sandbox program:
   - `market_metrics.py` — general single/multi-symbol metrics
   - `comparison.py` — cross-symbol comparison with pairwise matrix, tracking error, capture ratios
   - `risk_analysis.py` — VaR/CVaR, tail risk, rolling vol, drawdown detail, stress detection
   - `options_analysis.py` — IV stats, skew, ATM IV, put/call ratios, OI concentration
   - `fundamentals.py` — valuation comps, profitability, growth, balance sheet

3. **Data fetch** — Quotes, historical bars, and optionally fundamentals/options are fetched.

4. **Sandbox execution** — The selected program runs in a Python subprocess with resource limits. All computation happens here; only JSON comes back.

5. **Multi-timeframe** — When no explicit interval is given, the engine automatically runs daily, weekly, and monthly timeframes and merges the results.

6. **Recursive decomposition** — For multi-symbol queries, child analyses are spawned (each with their own intent classification and program selection).

7. **Synthesis** — If the host supports MCP sampling, the host LLM synthesizes the final narrative. Otherwise, a deterministic renderer produces structured text.

### Example: Multi-Symbol Comparison

```
yahoohoo_analyze({
  "query": "compare QQQ vs IWM vs TLT performance and risk",
  "symbols": ["QQQ", "IWM", "TLT"]
})
```

Intent detected: `comparison` (secondary: `risk`, `portfolio`). Program: `comparison.py`. Benchmark: SPY (auto-selected).

Heuristic narrative output:

```
Analysis objective: compare QQQ vs IWM vs TLT performance and risk
Scope: QQQ, IWM, TLT
Window: 2025-09-08 → 2026-03-07 (1wk)

Comparison snapshot:
- best total return: IWM (5.27%)
- best risk-adjusted return: IWM (0.16)
- best return over drawdown: IWM (0.94)
- lowest volatility: TLT (17.23%)
- shallowest drawdown: TLT (-4.85%)
- best excess return vs benchmark: IWM (2.99%)
- total return: IWM (5.27%) > QQQ (2.23%) > TLT (-1.66%)
- risk-adjusted return: IWM (0.16) > QQQ (0.07) > TLT (-0.10)
- return over drawdown: IWM (0.94) > QQQ (0.36) > TLT (-0.34)
- lowest volatility: TLT (17.23%) > QQQ (30.07%) > IWM (33.85%)
- shallowest drawdown: TLT (-4.85%) > IWM (-5.60%) > QQQ (-6.20%)
- excess return vs benchmark: IWM (2.99%) > QQQ (-0.05%) > TLT (-3.93%)

QQQ:
- last close: 599.75
- total return: 2.23%
- realized vol (ann.): 30.07%
- max drawdown: -6.20%
- market cap: 235.76B
- trailing P/E: 32.84

IWM:
- last close: 250.89
- total return: 5.27%
- realized vol (ann.): 33.85%
- max drawdown: -5.60%
- market cap: 70.51B
- trailing P/E: 18.33

TLT:
- last close: 88.46
- total return: -1.66%
- realized vol (ann.): 17.23%
- max drawdown: -4.85%
- market cap: 9.70B

QQQ vs SPY:
- beta: 1.31
- correlation: 0.93
- tracking error: 13.00%
- information ratio: -0.00
- upside capture: 132.19%
- downside capture: 137.03%

IWM vs SPY:
- beta: 1.23
- correlation: 0.77
- tracking error: 21.98%
- information ratio: 0.14
- upside capture: 102.59%
- downside capture: 77.63%

TLT vs SPY:
- beta: -0.01
- correlation: -0.01
- tracking error: 27.55%
- information ratio: -0.14
- upside capture: -20.43%
- downside capture: -12.48%

Pairwise:
- QQQ vs IWM: corr=0.65, rel.ret=-3.03%
- QQQ vs TLT: corr=-0.03, rel.ret=3.89%
- IWM vs TLT: corr=0.18, rel.ret=6.92%
```

The structured JSON output includes additional fields: Sharpe/Sortino ratios, downside vol, regime labels, daily-timeframe cross-section, and per-symbol child analysis nodes.

### Example: Risk Analysis

```
yahoohoo_analyze({
  "query": "risk and drawdown analysis for USO",
  "symbols": ["USO"]
})
```

Intent detected: `risk`. Program: `risk_analysis.py`. Benchmark: SPY (auto-selected for risk queries).

Heuristic narrative output:

```
Analysis objective: risk and drawdown analysis for USO
Scope: USO
Window: 2025-09-08 → 2026-03-07 (1wk)

USO:
- last close: 108.77
- total return: 48.37%
- realized vol (ann.): 83.13%
- VaR 95%: -4.32%
- CVaR 95%: -6.89%
- max drawdown period: 2025-09-22 → 2025-10-13 (-11.74%)

USO vs SPY:
- beta: 0.25
- correlation: 0.06
```

Structured metrics include tail risk, drawdown detail, rolling volatility, and stress period detection:

```json
{
  "tail_risk": {
    "var_95": -0.0432,
    "var_99": -0.0689,
    "cvar_95": -0.0689,
    "cvar_99": -0.0689,
    "worst_day": -0.0689,
    "best_day": 0.1752,
    "skewness": 1.40,
    "kurtosis_excess": 1.66
  },
  "drawdown": {
    "max_drawdown": -0.1174,
    "peak_date": "2025-09-22",
    "trough_date": "2025-10-13"
  },
  "rolling_vol": {
    "window": 20,
    "current": 0.833,
    "min": 0.519,
    "max": 0.833,
    "mean": 0.623
  },
  "stress_periods": [
    { "start": "2025-09-29", "end": "2025-10-13", "cum_return": -0.1174, "days": 3 }
  ]
}
```

### Example: Multi-Symbol Risk with Benchmark

```
yahoohoo_analyze({
  "query": "compare risk-adjusted performance",
  "symbols": ["QQQ", "IWM", "USO"],
  "benchmark": "SPY"
})
```

Intent detected: `risk` (secondary: `comparison`, `portfolio`). Program: `risk_analysis.py`.

Output includes per-symbol VaR/CVaR, drawdown periods, stress detection, a correlation matrix, and benchmark comparisons:

```
QQQ:
- total return: 2.23%, Sharpe: 0.07, Sortino: 0.14
- VaR 95%: -3.07%, CVaR 95%: -3.09%
- max drawdown: 2025-10-27 → 2025-11-17 (-6.20%)

IWM:
- total return: 5.27%, Sharpe: 0.16, Sortino: 0.45
- VaR 95%: -2.29%, CVaR 95%: -3.27%
- max drawdown: 2026-01-12 → 2026-03-06 (-5.60%)

USO:
- total return: 48.37%, Sharpe: 0.58, Sortino: 1.74
- VaR 95%: -4.32%, CVaR 95%: -6.89%
- max drawdown: 2025-09-22 → 2025-10-13 (-11.74%)
- stress period detected: 2025-09-29 → 2025-10-13 (-11.74%)

Correlation matrix:
- QQQ vs IWM: 0.65
- QQQ vs USO: 0.16
- IWM vs USO: -0.17
```

### Confidence Scoring

Each analysis node includes a `confidence` score (0-1) based on:
- Data completeness (did all symbols return data?)
- Sample size (more bars = higher confidence)
- Sandbox success (did computation complete without errors?)
- Coverage warnings (missing data, short time windows)

Typical single-symbol analysis with 6 months of data scores **0.82**. All five analysis runs above returned confidence of 0.82, consistent with complete data coverage and successful sandbox execution.

### Multi-Timeframe

When no explicit interval is given, the engine automatically runs analysis at multiple timeframes. For a 180-day window, the primary interval is weekly (27 bars) with daily (125 bars) as an additional timeframe:

```json
{
  "interval": "1wk",
  "metrics": {
    "symbols": {
      "TLT": {
        "history": { "bars": 27, "total_return": -0.0166, "realized_vol_annualized": 0.1723 }
      }
    },
    "timeframes": {
      "daily": {
        "symbols": {
          "TLT": {
            "history": { "bars": 125, "total_return": -0.0143, "realized_vol_annualized": 0.0867 }
          }
        }
      }
    }
  }
}
```

Note: Realized volatility differs across timeframes because weekly returns have higher variance than daily returns (volatility scaling). Both views are provided to give a more complete picture.

---

## MCP Resources

Completed analyses are automatically saved and exposed as MCP resources at `yahoohoo://analysis/{id}`.

- `resources/list` returns all saved runs with their symbols, query, and creation time
- `resources/read` with a `yahoohoo://analysis/{id}` URI returns the full analysis JSON
- `resources/templates/list` returns the template URI pattern

The maximum number of saved runs is configurable via `YAHOOHOO_MAX_SAVED_RUNS` (default: 100).

---

## MCP Prompt

Yahoohoo registers one prompt template:

**`market_study_prompt`** — Generates a reusable prompt for host-side analysis.

| Argument | Required |
|----------|----------|
| `objective` | yes |
| `symbols` | no |

```
Use Yahoohoo to analyze this market question: analyze tech sector rotation
Symbols: QQQ,XLK,SOXX. Prefer yahoohoo_analyze first, then drill down with direct yahoo_* tools if needed.
```

---

## Configuration

All configuration is via environment variables. No config files.

| Variable | Default | Description |
|----------|---------|-------------|
| `YAHOOHOO_TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `YAHOOHOO_HOST` | `127.0.0.1` | HTTP bind address |
| `YAHOOHOO_PORT` | `3434` | HTTP port |
| `YAHOOHOO_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Host header allow-list (comma-separated) |
| `YAHOOHOO_API_KEYS` | *(none)* | Comma-separated API keys for HTTP auth (Bearer token) |
| `YAHOOHOO_RATE_LIMIT` | `60` | Max requests per minute per IP |
| `YAHOOHOO_MAX_SESSIONS` | `50` | Max concurrent MCP sessions (HTTP mode) |
| `YAHOOHOO_DATA_PROVIDER` | `yahoo` | Market data provider |
| `YAHOOHOO_CACHE_TTL_MS` | `30000` | Market data cache TTL |
| `YAHOOHOO_DEFAULT_LOOKBACK_DAYS` | `180` | Default historical window |
| `YAHOOHOO_DEFAULT_BENCHMARK` | `SPY` | Default benchmark symbol |
| `YAHOOHOO_DEFAULT_SUMMARY_MODULES` | `price,summaryDetail,...` | Quote summary modules |
| `YAHOOHOO_REASONING_MODE` | `auto` | Default reasoning mode: `auto`, `sampling`, `heuristic` |
| `YAHOOHOO_MAX_DEPTH` | `2` | Max recursion depth |
| `YAHOOHOO_MAX_CHILDREN` | `3` | Max child analyses per level |
| `YAHOOHOO_ENABLE_SAMPLING` | `true` | Enable MCP sampling requests |
| `YAHOOHOO_SAMPLING_MAX_TOKENS` | `900` | Max tokens for sampling responses |
| `YAHOOHOO_SAMPLING_TEMPERATURE` | `0.2` | Sampling temperature |
| `YAHOOHOO_PYTHON` | `python3` | Python command for sandbox |
| `YAHOOHOO_SANDBOX_TIMEOUT_MS` | `20000` | Sandbox execution timeout |
| `YAHOOHOO_SANDBOX_CPU_SECONDS` | `10` | Max CPU seconds |
| `YAHOOHOO_SANDBOX_MEMORY_MB` | `512` | Max memory for sandbox |
| `YAHOOHOO_SANDBOX_OUTPUT_BYTES` | `200000` | Max sandbox output size |
| `YAHOOHOO_SANDBOX_ALLOW_NUMPY` | `true` | Allow numpy in sandbox |
| `YAHOOHOO_SANDBOX_ALLOW_PANDAS` | `true` | Allow pandas in sandbox |
| `YAHOOHOO_SANDBOX_STRICT_FILES` | `false` | Strict file isolation |
| `YAHOOHOO_DRAIN_TIMEOUT_MS` | `10000` | Graceful shutdown drain timeout |
| `YAHOOHOO_MAX_SAVED_RUNS` | `100` | Max saved analysis runs |
| `YAHOOHOO_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

---

## HTTP Mode Details

The HTTP transport provides:

- **Streamable HTTP** at `POST /mcp` (initialize), `GET /mcp` (SSE), `DELETE /mcp` (close session)
- **Health endpoint** at `GET /health` returning `{ "status": "ok", "server": "yahoohoo", "version": "0.1.0", "sessions": 1 }`
- **API key auth** via `Authorization: Bearer <key>` when `YAHOOHOO_API_KEYS` is set
- **Rate limiting** with `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers
- **Session tracking** via `mcp-session-id` header
- **Request IDs** via `X-Request-Id` header with latency logging
- **Host header guard** when bound to `0.0.0.0`

### Error Handling

All errors return structured JSON-RPC error responses:

```json
// Nonexistent tool
{"result":{"content":[{"type":"text","text":"MCP error -32602: Tool nonexistent_tool not found"}],"isError":true}}

// Invalid arguments
{"result":{"content":[{"type":"text","text":"MCP error -32602: Input validation error: Invalid arguments for tool yahoo_quote: Invalid input: expected array, received string"}],"isError":true}}

// No symbols found
{"result":{"content":[{"type":"text","text":"Could not infer any symbols. Pass symbols explicitly or mention ticker-like names in the query."}],"isError":true}}

// Invalid session
{"jsonrpc":"2.0","error":{"code":-32000,"message":"No valid session ID provided."},"id":null}
```

---

## Deployment

### Docker Compose

```bash
docker compose up -d
```

The included `docker-compose.yml` configures all env vars with production defaults.

### Fly.io

```bash
fly launch --config deploy/fly.toml
fly deploy
```

### Railway

Import the repo and point Railway at `deploy/railway.toml`.

### CI

GitHub Actions CI (`.github/workflows/ci.yml`) runs:
- `npm run check` — syntax check
- `npm test` — 182 deterministic tests
- `npm run smoke:sandbox` — Python sandbox smoke test

---

## Architecture

Three-layer design, all plain ESM JavaScript (no TypeScript, no bundler):

**Layer 1 — Data plane:** `src/adapters/` wraps yahoo-finance2. `MarketDataProvider` abstract base class with provider registry for future data sources (`YAHOOHOO_DATA_PROVIDER`).

**Layer 2 — Orchestrator:** `src/core/` contains the recursive analyzer, intent classifier, program registry, sampling wrapper, and heuristic renderer.

**Layer 3 — Execution:** `src/sandbox/` spawns Python subprocesses with restricted imports, resource limits, and JSON-only output. Five specialized programs for different analysis intents.

**Wiring:** `src/server.js` assembles everything. `src/tools.js` registers MCP tools, prompts, and resources. `src/http.js` adds Express middleware for auth, rate limiting, and session management.

See `CLAUDE.md` for detailed architecture documentation.

---

## Development

```bash
npm install                # install dependencies
npm run check              # syntax-check all source files
npm test                   # 182 deterministic tests (no network)
npm run test:live          # 184 tests including live Yahoo Finance integration
npm run smoke:sandbox      # smoke test the Python sandbox
```

---

## Security Model

The Python sandbox is a **practical local sandbox**, not VM-level isolation. It restricts dangerous imports (`os`, `subprocess`, `socket`, etc.), blocks `eval`/`exec`/`open`/`__import__`, and applies CPU/memory limits where Python's `resource` module is available.

For production deployments, run Yahoohoo inside a container, VM, or namespace sandbox (nsjail, gVisor, Firejail).

---

## Limitations

- Yahoo Finance is an unofficial data source. Response shapes can change; the adapter handles failures gracefully but cannot guarantee availability.
- Options chain data from yahoo-finance2 returns empty call/put arrays. Expiration dates and strikes are returned correctly, but IV skew, put/call ratios, and OI metrics will be null. This is a known upstream issue.
- Sampling depends on the host's MCP implementation. Most hosts don't support `requestSampling()` yet, so heuristic mode is the common path. The analysis engine falls back gracefully.
- The sandbox blocks network access but is not equivalent to a hardened VM boundary.
- Interval values must be valid Yahoo Finance intervals.
- Fundamental fields (profit margins, ROE, etc.) are null for ETFs, as expected — these are equity-specific metrics.

---

## License

MIT
