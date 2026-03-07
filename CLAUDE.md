# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Yahoohoo is an MCP server for market-data analysis. It combines Yahoo Finance data (`yahoo-finance2`), recursive analysis with sandboxed Python execution, and host-provided reasoning via MCP sampling. It does **not** own a model — the MCP host provides the LLM.

## Commands

```bash
npm install                # install dependencies (Node 22+)
npm run check              # syntax-check all source files
npm test                   # run full test suite (213 deterministic tests, no network)
npm run test:live          # run tests including live Yahoo Finance integration (184 total)
npm run smoke:sandbox      # run sandbox smoke test via Python
node src/index.js --transport stdio   # start in stdio mode
node src/index.js --transport http    # start in HTTP mode (default port 3434)
```

## Architecture

Three-layer design, all plain ESM JavaScript (no TypeScript, no bundler):

### Layer 1 — Data plane
`src/adapters/base.js` — `MarketDataProvider` abstract base class defining the interface for all market data sources (search, quote, historical, quoteSummary, options).

`src/adapters/yahoo.js` — `YahooMarketData extends MarketDataProvider`. Wraps `yahoo-finance2`. Uses `chart()` API (not deprecated `historical()`). Normalizes search, quotes, historical bars, quote summaries, and option chains. Has a short TTL cache to avoid repeated calls during recursive analysis.

`src/adapters/coingecko.js` — `CoinGeckoData` supplementary crypto provider. Wraps CoinGecko's free public API for trending coins, global market stats, top coins by market cap, coin details, and search. No API key required (optional demo key via `COINGECKO_API_KEY` for higher rate limits). TTL-cached.

`src/adapters/index.js` — Provider registry. `createMarketDataProvider()` selects the provider via `YAHOOHOO_DATA_PROVIDER` env var (default: `yahoo`). Future providers plug in here.

### Layer 2 — Recursive orchestrator
`src/core/analyzer.js` — `RecursiveMarketAnalyzer` decides which symbols to analyze, whether to split into child analyses, and whether to use host sampling or heuristic fallback. Features:
- **Sampling mode**: asks host LLM via MCP sampling to propose child questions and synthesize results
- **Heuristic mode**: deterministic decomposition and narrative rendering via `src/core/heuristics.js`
- **Intent-aware child decomposition**: each child query gets its own intent classification and program selection
- **Multi-timeframe analysis**: auto-selects multiple intervals (daily/weekly/monthly) when no explicit interval is given
- **Confidence scoring**: 0-1 score based on data completeness, sample size, and sandbox success
- **Progress notifications**: emits MCP `notifications/progress` at data fetch, sandbox, child analysis, and synthesis milestones

`src/core/sampling.js` — `trySampling()` wrapper for MCP `sampling/createMessage`.

`src/core/intents.js` — Intent classifier: detects comparison, options, fundamentals, risk, macro, portfolio, or general queries.

`src/core/programs.js` — Program registry mapping intents to specialized sandbox programs.

### Layer 3 — Execution plane
`src/sandbox/index.js` — `PythonSandbox` spawns `src/sandbox/runner.py` as a subprocess. All numerical computation runs here. JSON-only output channel back to Node. Includes timing instrumentation. Uses structured `SandboxError`/`SandboxTimeoutError` from `src/lib/errors.js`.

`src/sandbox/programs/` — Versioned Python analysis programs loaded by intent:
- `market_metrics.py` — General single/multi-symbol metrics (default)
- `comparison.py` — Cross-symbol comparison with pairwise matrix, tracking error, information ratio, capture ratios, regime labels
- `options_analysis.py` — IV stats, skew, ATM IV, put/call ratios, OI concentration, IV vs realized vol, multi-expiry sweep, 0DTE detection, aggregate dealer-position proxy
- `fundamentals.py` — Deep valuation comps, profitability, growth, balance sheet, capital allocation
- `risk_analysis.py` — VaR/CVaR, tail risk, rolling vol, drawdown detail, stress detection, correlation matrix

### Wiring
- `src/index.js` — Entry point. Parses `--transport` arg, sets up stdio or Express HTTP server with Streamable HTTP MCP transport. Installs SIGTERM/SIGINT graceful shutdown handler with configurable drain timeout.
- `src/http.js` — HTTP transport wiring with host-header guard, API key auth, rate limiting, session limits (`YAHOOHOO_MAX_SESSIONS`), request logging with IDs and timing, `/mcp` routing, and `/health` readiness endpoint.
- `src/server.js` — `createYahoohooServer()` wires together marketData (via provider registry), sandbox, analyzer, runStore, and registers tools + resources.
- `src/tools.js` — `registerTools()` defines all 17 MCP tools: Yahoo data tools (`yahoo_search`, `yahoo_quote`, `yahoo_historical`, `yahoo_quote_summary`, `yahoo_options`, `yahoo_screener`, `yahoo_trending`, `yahoo_insights`), crypto tools (`crypto_trending`, `crypto_global`, `crypto_markets`, `crypto_coin`, `crypto_search`), and analysis tools (`yahoohoo_analyze`, `yahoohoo_peek`, `yahoohoo_drill`, `yahoohoo_options_dashboard`). Also one prompt (`market_study_prompt`) and an MCP resource template (`yahoohoo://analysis/{id}`) for saved analysis runs.

### Utilities (`src/lib/`)
- `config.js` — All configuration from env vars with defaults (see `loadConfig()`)
- `errors.js` — Structured error hierarchy: `YahoohooError` base, `ValidationError`, `ToolNotFoundError`, `SandboxError`, `SandboxTimeoutError`, `DataFetchError`, `RateLimitError`, `AuthError`, `SessionLimitError`. Each has code string, HTTP status, and JSON-RPC error code.
- `runStore.js` — In-memory store for completed analysis runs, exposed as MCP resources. Configurable max via `YAHOOHOO_MAX_SAVED_RUNS`.
- `cache.js`, `dates.js`, `json.js`, `logger.js` — Small helpers

### Deployment
- `Dockerfile` — node:22-bookworm-slim, non-root user, Python 3, health check
- `docker-compose.yml` — Production-ready compose with all env vars
- `.github/workflows/ci.yml` — GitHub Actions CI (npm test, syntax check, sandbox smoke)
- `deploy/fly.toml` — Fly.io deployment config
- `deploy/railway.toml` — Railway deployment config

## Key design decisions

- Test suite uses `node:test` (built-in, no deps) — `npm test` runs 209 deterministic tests covering lib (cache, dates, json, config, errors, runStore), heuristics (confidence), intents, programs, sandbox (all programs), sampling, analyzer (confidence, intent-aware children), adapters (provider abstraction, CoinGecko), HTTP transport (auth/rate-limit/session-limits), and MCP E2E (session lifecycle, tool calls, prompts, resources, errors); `npm run test:live` adds live Yahoo Finance integration coverage
- The sandbox blocks dangerous imports, `eval`/`exec`/`open`, and applies resource limits where Python's `resource` module is available. It is **not** VM-level isolation.
- Tool input schemas use Zod 4 (`z.object(...)`) registered via `server.registerTool()`
- Config is purely env-var driven — no config files. See `src/lib/config.js` for all `YAHOOHOO_*` variables.
- HTTP mode uses Express 5 with host-header guard, API key auth (`YAHOOHOO_API_KEYS`), per-IP rate limiting (`YAHOOHOO_RATE_LIMIT`), session limits (`YAHOOHOO_MAX_SESSIONS`), and request-id tracking
- Graceful shutdown on SIGTERM/SIGINT with configurable drain timeout (`YAHOOHOO_DRAIN_TIMEOUT_MS`)
- All errors use structured `YahoohooError` hierarchy with consistent JSON-RPC error codes
- Market data provider abstraction allows swapping data sources via `YAHOOHOO_DATA_PROVIDER`
