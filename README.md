```
                    ╭─────────────────────────────────────────╮
                    │                                         │
  ╭──╮              │   Y A H O O                             │
  │$$│  ┌──┐        │           h o o                         │
  │$$│  │▓▓│ ┌──┐   │              o o o                      │
  │$$│  │▓▓│ │░░│   │                 o o o ~                 │
  │$$│  │▓▓│ │░░│   │   recursive market analysis             │
  └──┘  └──┘ └──┘   │   for AI that actually trades           │
  ───────────────   │                                         │
  SPY QQQ IWM       ╰─────────────────────────────────────────╯

  MCP server · Yahoo Finance · CoinGecko · sandboxed Python · zero API keys
```

# Yahoohoo

An MCP server that gives AI assistants real market-data analysis capabilities. It connects to Yahoo Finance for equities/ETFs/indices and CoinGecko for crypto, runs numerical computations in a sandboxed Python subprocess, and optionally uses the host LLM for recursive reasoning — all without needing an API key.

```text
MCP Host (Claude, Codex, ChatGPT, etc.)
  ├─ calls yahoohoo tools
  ├─ optionally serves sampling back to Yahoohoo
  ▼
Yahoohoo MCP Server (Node.js)
  ├─ Yahoo Finance adapter (search, quotes, OHLCV, options, fundamentals)
  ├─ CoinGecko adapter (crypto prices, trending, market cap rankings, coin details)
  ├─ intent classifier → program selector
  ├─ recursive analysis engine (comparison, risk, options, fundamentals)
  └─ Python sandbox (numpy/pandas, resource limits, JSON-only output)
```

Yahoohoo does **not** own the model. The MCP host provides the reasoning layer. When the host supports MCP sampling, Yahoohoo uses it for recursive decomposition and synthesis. When it doesn't, everything still works via deterministic heuristics.

---

## Install

```bash
npm install -g yahoohoo
# or
npx yahoohoo --transport stdio
```

Requires Node 22+ and Python 3.

### From source

```bash
git clone https://github.com/Hmbown/yahoohoo.git
cd yahoohoo && npm install

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
# or
docker compose up
```

### Host Configuration

**Claude Code:**
```bash
claude mcp add --transport stdio yahoohoo -- npx yahoohoo --transport stdio
```

**Codex:**
```bash
codex mcp add yahoohoo -- npx yahoohoo --transport stdio
```

**ChatGPT:** Run in HTTP mode behind HTTPS, point the connector at `https://<host>/mcp`.

---

## Tools (17)

### Data Tools (Yahoo Finance)

| Tool | Description |
|------|-------------|
| `yahoo_search` | Search instruments by name, symbol, or keyword |
| `yahoo_quote` | Current quote snapshots for up to 20 symbols |
| `yahoo_historical` | OHLCV bars with optional `summary=true` for computed stats |
| `yahoo_quote_summary` | Company profile and fundamental modules |
| `yahoo_options` | Option chain snapshots with multi-expiry sweep (`expiries` param) |
| `yahoo_screener` | Predefined screens: day_gainers, day_losers, most_actives, etc. |
| `yahoo_trending` | Currently trending symbols by region |
| `yahoo_insights` | Technical levels, outlook, analyst recs, significant developments |

### Crypto Tools (CoinGecko)

| Tool | Description |
|------|-------------|
| `crypto_trending` | Currently trending coins and categories |
| `crypto_global` | Global market overview: total cap, BTC/ETH dominance, volume |
| `crypto_markets` | Top coins by market cap with price changes (1h/24h/7d/30d) |
| `crypto_coin` | Detailed coin info: supply, ATH/ATL, description, categories |
| `crypto_search` | Search coins by name/symbol, returns CoinGecko IDs |

> **Note:** Yahoo Finance also handles crypto symbols directly (e.g., `BTC-USD`, `ETH-USD`) for quotes and historical data via `yahoo_quote` and `yahoo_historical`. The crypto tools add CoinGecko-specific data that Yahoo doesn't provide: trending coins, global market overview, market cap rankings, and detailed coin metadata.

### Analysis Tools (RLM pattern)

| Tool | Description |
|------|-------------|
| `yahoohoo_analyze` | Recursive sandboxed analysis — returns compact summary + runId |
| `yahoohoo_peek` | Navigate stored analysis by dot-path (e.g., `metrics.symbols.QQQ.tail_risk`) |
| `yahoohoo_drill` | Follow-up analysis inheriting params from a previous run |
| `yahoohoo_options_dashboard` | Visual ASCII options dashboard — GEX profile, key levels, dealer positioning |

---

## Options Dashboard

The `yahoohoo_options_dashboard` tool generates a thinkorswim-style visual dashboard directly in your terminal. It sweeps multiple expiry dates and renders:

- **GEX Profile** — horizontal bar chart of net gamma exposure by strike
- **Key Levels** — spot, max pain, call/put wall, gamma flip, ATM IV
- **IV Term Structure** — ATM IV across expiry dates
- **Expiry Sweep** — per-expiry summary table
- **0DTE** — same-day expiry details (when active)
- **Dealer Profile** — aggregate positioning, regime, max-pain ladder

```
yahoohoo_options_dashboard({ "symbol": "SPY", "expiries": 5 })
```

```
════════════════════════════════════════════════════════
  SPY OPTIONS DASHBOARD
════════════════════════════════════════════════════════

── Key Levels ──────────────────────────────────────────
  Spot Price         572.35
  Max Pain           575.00  (0.5% vs spot)
  Call Wall          590.00  OI: 45.2K
  Put Wall           555.00  OI: 38.1K
  Gamma Flip         583.25  (1.9% vs spot)
  ATM IV             22.5%
  P/C OI Ratio       0.85
  Net GEX (1%)       -2.9B
  Total OI           312.4K

── GEX Profile ─────────────────────────────────────────
   spot: 572.35
   γ-flip: 583.25 (+1.90% vs spot)

      555 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│                       -1.2B
      560 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓       │                       -0.8B
      565 ▓▓▓▓▓▓▓▓▓             │                       -0.5B
      570 ▓▓▓▓                  │                       -0.2B ◄ spot
      575                      │██████████              +0.6B
      580                      │████████████████████    +1.2B
      585                      │██████████████████████  +1.5B ◄ γ-flip
      590                      │████████████████        +0.9B
      595                      │████████                +0.4B
                         ◁ puts calls ▷

── IV Term Structure ───────────────────────────────────
    2d   25.3%  █
    5d   22.1%  ░░░░░░░░░░░░█
    9d   20.5%  ░░░░░░░░░░░░░░░░░░░░█
   12d   19.2%  ░░░░░░░░░░░░░░░░░░░░░░░░░█

── Expiry Sweep (5 expiries) ─────────────────────────
  Expiry        DTE        OI   MaxPain    NetGEX  ATM IV
  ──────────── ────  ────────  ────────  ────────  ──────
  2026-03-09      2    125.4K    575.00    -1.2B    25.3%
  2026-03-10      3     98.2K    577.00    -0.8B    23.1%
  2026-03-11      4     87.1K    576.00    -0.5B    21.8%
  2026-03-12      5     76.8K    574.00    +0.3B    20.5%
  2026-03-13      6     65.4K    573.00    +0.7B    19.2%

── Dealer Profile (proxy) ──────────────────────────────
  Expiries Included      5
  Aggregate Net GEX      -2.9B
  Regime                 Negative γ (amplifying)
  Gamma Flip (agg)       583.25 (1.9% vs spot)
  Top +GEX Strikes       585(+1.5B), 590(+0.9B), 580(+1.2B)
  Top -GEX Strikes       555(-1.2B), 560(-0.8B), 565(-0.5B)

  Max Pain Ladder:
    2026-03-09 (2d): 575.00 (0.5%)
    2026-03-10 (3d): 577.00 (0.8%)
    2026-03-11 (4d): 576.00 (0.6%)

════════════════════════════════════════════════════════
  Proxy data · OI-based BS gamma · Not exact dealer inventory
════════════════════════════════════════════════════════
```

You can also extract dashboards from stored analysis runs:

```
yahoohoo_options_dashboard({ "runId": "abc123" })
yahoohoo_options_dashboard({ "runId": "abc123", "symbol": "TSLA" })
```

Or access the dashboard via `yahoohoo_peek`:

```
yahoohoo_peek({ "runId": "abc123", "path": "metrics.symbols.SPY.options._dashboard" })
```

---

## Recursive Analysis Engine

### How it works

1. **Intent classification** — The query and symbols are classified into one of: `comparison`, `options`, `fundamentals`, `risk`, `macro`, `portfolio`, or `general`.

2. **Program selection** — Each intent maps to a specialized Python sandbox program:
   - `market_metrics.py` — general single/multi-symbol metrics
   - `comparison.py` — cross-symbol comparison with pairwise matrix, tracking error, capture ratios
   - `risk_analysis.py` — VaR/CVaR, tail risk, rolling vol, drawdown detail, stress detection
   - `options_analysis.py` — IV stats, skew, ATM IV, put/call ratios, OI concentration, max pain, proxy GEX/gamma-flip, multi-expiry sweep, 0DTE detection, aggregate dealer-position profile, and visual dashboard rendering
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

QQQ:
- last close: 599.75
- total return: 2.23%
- realized vol (ann.): 30.07%
- max drawdown: -6.20%

IWM:
- last close: 250.89
- total return: 5.27%
- realized vol (ann.): 33.85%
- max drawdown: -5.60%

QQQ vs SPY:
- beta: 1.31, correlation: 0.93
- tracking error: 13.00%, information ratio: -0.00

Pairwise:
- QQQ vs IWM: corr=0.65, rel.ret=-3.03%
- QQQ vs TLT: corr=-0.03, rel.ret=3.89%
```

### Example: Risk Analysis

```
yahoohoo_analyze({
  "query": "risk and drawdown analysis for USO",
  "symbols": ["USO"]
})
```

```
USO:
- total return: 48.37%
- realized vol (ann.): 83.13%
- VaR 95%: -4.32%
- CVaR 95%: -6.89%
- max drawdown period: 2025-09-22 → 2025-10-13 (-11.74%)

USO vs SPY:
- beta: 0.25, correlation: 0.06
```

### Confidence Scoring

Each analysis node includes a `confidence` score (0-1) based on data completeness, sample size, sandbox success, and coverage warnings.

---

## Configuration

All configuration is via environment variables. No config files.

| Variable | Default | Description |
|----------|---------|-------------|
| `YAHOOHOO_TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `YAHOOHOO_HOST` | `127.0.0.1` | HTTP bind address |
| `YAHOOHOO_PORT` | `3434` | HTTP port |
| `YAHOOHOO_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Host header allow-list |
| `YAHOOHOO_API_KEYS` | *(none)* | Comma-separated API keys for HTTP auth |
| `YAHOOHOO_RATE_LIMIT` | `60` | Max requests per minute per IP |
| `YAHOOHOO_MAX_SESSIONS` | `50` | Max concurrent MCP sessions |
| `YAHOOHOO_DATA_PROVIDER` | `yahoo` | Market data provider |
| `COINGECKO_API_KEY` | *(none)* | CoinGecko demo API key (optional, increases rate limit) |
| `YAHOOHOO_CACHE_TTL_MS` | `30000` | Market data cache TTL |
| `YAHOOHOO_DEFAULT_LOOKBACK_DAYS` | `180` | Default historical window |
| `YAHOOHOO_DEFAULT_BENCHMARK` | `SPY` | Default benchmark symbol |
| `YAHOOHOO_OPTIONS_MAX_EXPIRIES` | `5` | Max expiries to sweep |
| `YAHOOHOO_REASONING_MODE` | `auto` | Default: `auto`, `sampling`, `heuristic` |
| `YAHOOHOO_MAX_DEPTH` | `2` | Max recursion depth |
| `YAHOOHOO_MAX_CHILDREN` | `3` | Max child analyses per level |
| `YAHOOHOO_ENABLE_SAMPLING` | `true` | Enable MCP sampling requests |
| `YAHOOHOO_PYTHON` | `python3` | Python command for sandbox |
| `YAHOOHOO_SANDBOX_TIMEOUT_MS` | `20000` | Sandbox execution timeout |
| `YAHOOHOO_SANDBOX_CPU_SECONDS` | `10` | Max CPU seconds |
| `YAHOOHOO_SANDBOX_MEMORY_MB` | `512` | Max memory for sandbox |
| `YAHOOHOO_DRAIN_TIMEOUT_MS` | `10000` | Graceful shutdown drain timeout |
| `YAHOOHOO_MAX_SAVED_RUNS` | `100` | Max saved analysis runs |
| `YAHOOHOO_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

---

## HTTP Mode

- **Streamable HTTP** at `POST /mcp` (initialize), `GET /mcp` (SSE), `DELETE /mcp` (close)
- **Health endpoint** at `GET /health`
- **API key auth** via `Authorization: Bearer <key>` when `YAHOOHOO_API_KEYS` is set
- **Rate limiting** with `X-RateLimit-*` headers
- **Session tracking** via `mcp-session-id` header
- **Request IDs** via `X-Request-Id` header

---

## Deployment

```bash
# Docker Compose
docker compose up -d

# Fly.io
fly launch --config deploy/fly.toml && fly deploy

# Railway — import repo, point at deploy/railway.toml
```

CI runs `npm run check`, `npm test` (209 tests), and `npm run smoke:sandbox`.

---

## Development

```bash
npm install                # install dependencies
npm run check              # syntax-check all source files
npm test                   # 205 deterministic tests (no network)
npm run test:live          # tests including live Yahoo Finance integration
npm run smoke:sandbox      # smoke test the Python sandbox
```

---

## Roadmap

Things we're thinking about building. PRs welcome.

### Data Sources
- **Real-time streaming** — WebSocket feed for live quotes and options flow
- **FRED / macro data** — Federal Reserve economic data (rates, CPI, employment) via FRED API
- **Earnings calendar integration** — Pre/post earnings analysis with expected move calculations
- **Binance deep OHLCV** — High-resolution crypto candles (1s to 1M intervals) via Binance public API
- **On-chain data** — DeFi TVL, whale movements, exchange flows via free APIs (DefiLlama, etc.)
- **Alternative data adapters** — Polygon.io, Alpha Vantage, IEX Cloud as drop-in replacements via `YAHOOHOO_DATA_PROVIDER`

### Analysis
- **Backtesting engine** — Test strategies against historical data in the sandbox
- **Portfolio optimization** — Mean-variance, risk parity, and Black-Litterman allocation
- **Sector/factor decomposition** — Break down returns by sector, factor, and style exposure
- **Event studies** — Measure price impact around earnings, FOMC, CPI releases
- **Options strategy builder** — Model spreads, straddles, iron condors with P&L visualization

### Visualization
- **SVG chart output** — Generate proper SVG charts for hosts that support image content
- **Interactive HTML dashboards** — Self-contained HTML files with embedded charts
- **Sparklines in narratives** — Inline mini-charts in text summaries

### Platform
- **User profiles** — Save preferred symbols, benchmarks, analysis defaults per user
- **Alerts / watchlists** — Persistent monitors with threshold notifications via MCP
- **Analysis templates** — Reusable analysis configurations (e.g., "weekly portfolio review")
- **Webhook triggers** — Fire analysis on schedule or market events
- **Multi-provider blending** — Combine data from multiple sources with quality scoring

### Infrastructure
- **Redis-backed RunStore** — Persistent analysis storage across restarts
- **Cluster mode** — Horizontal scaling with shared state
- **OpenTelemetry tracing** — Distributed tracing for the full analysis pipeline
- **Rate-aware data fetching** — Respect upstream API limits with adaptive backoff

---

## Security Model

The Python sandbox is a **practical local sandbox**, not VM-level isolation. It restricts dangerous imports (`os`, `subprocess`, `socket`, etc.), blocks `eval`/`exec`/`open`/`__import__`, and applies CPU/memory limits where Python's `resource` module is available.

For production deployments, run Yahoohoo inside a container, VM, or namespace sandbox (nsjail, gVisor, Firejail).

---

## Limitations

- Yahoo Finance is an unofficial data source. Response shapes can change; the adapter handles failures gracefully but cannot guarantee availability.
- Options chain data quality depends on the underlying. Major ETFs (SPY, QQQ) have rich chains; smaller tickers may have sparse data.
- Dealer-position outputs (GEX, gamma flip, dealer profile) are **proxies** based on open interest and Black-Scholes gamma. They do not represent exact dealer inventory.
- Sampling depends on the host's MCP implementation. Most hosts don't support `requestSampling()` yet, so heuristic mode is the common path.
- The sandbox blocks network access but is not equivalent to a hardened VM boundary.

---

## License

MIT
