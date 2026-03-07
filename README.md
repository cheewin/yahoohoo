```
                    ╭─────────────────────────────────────────╮
                    │                                         │
  ╭──╮              │   Y A H O O                             │
  │$$│  ┌──┐        │           h o o                         │
  │$$│  │▓▓│ ┌──┐   │              o o o                      │
  │$$│  │▓▓│ │░░│   │                 o o o ~                 │
  │$$│  │▓▓│ │░░│   │   recursive market analysis             │
  └──┘  └──┘ └──┘   │   mcp · yahoo finance · coingecko      │
  ───────────────   │                                         │
  SPY QQQ BTC       ╰─────────────────────────────────────────╯
```

# Yahoohoo

MCP server for market-data analysis. Yahoo Finance for equities/ETFs/options, CoinGecko for crypto. Sandboxed Python for numerical computation. No API keys required.

Works with any MCP host — Claude, Codex, ChatGPT, Cursor, Windsurf. When the host supports MCP sampling, Yahoohoo uses it for recursive reasoning. When it doesn't, deterministic heuristics cover everything.

## Install

```bash
npm install -g yahoohoo
yahoohoo --transport stdio
```

Requires Node 22+ and Python 3.

## Host Setup

**Claude Code:**
```bash
claude mcp add --transport stdio yahoohoo -- npx yahoohoo --transport stdio
```

**Codex:**
```bash
codex mcp add yahoohoo -- npx yahoohoo --transport stdio
```

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "yahoohoo": {
      "command": "npx",
      "args": ["yahoohoo", "--transport", "stdio"]
    }
  }
}
```

**ChatGPT / remote hosts** — run in HTTP mode behind HTTPS. See [docs/CHATGPT.md](docs/CHATGPT.md).

## Tools

### Market Data (Yahoo Finance)

| Tool | What it does |
|------|-------------|
| `yahoo_search` | Find instruments by name or symbol |
| `yahoo_quote` | Current quotes for up to 20 symbols |
| `yahoo_historical` | OHLCV bars, or `summary=true` for computed stats |
| `yahoo_quote_summary` | Fundamentals and company profile |
| `yahoo_options` | Option chains with multi-expiry sweep |
| `yahoo_screener` | day_gainers, day_losers, most_actives, etc. |
| `yahoo_trending` | Trending symbols by region |
| `yahoo_insights` | Technical levels, outlook, analyst recs |

### Crypto (CoinGecko)

| Tool | What it does |
|------|-------------|
| `crypto_trending` | Trending coins and categories |
| `crypto_global` | Total market cap, BTC/ETH dominance, volume |
| `crypto_markets` | Top coins by market cap with price changes |
| `crypto_coin` | Detailed coin info — supply, ATH/ATL, categories |
| `crypto_search` | Search coins, get CoinGecko IDs |

Yahoo Finance also handles crypto symbols directly (`BTC-USD`, `ETH-USD`) for quotes and historical data. The crypto tools add what Yahoo doesn't: trending, global overview, market cap rankings, coin metadata.

### Recursive Analysis

| Tool | What it does |
|------|-------------|
| `yahoohoo_analyze` | Sandboxed analysis — returns summary + runId |
| `yahoohoo_peek` | Navigate stored results by dot-path |
| `yahoohoo_drill` | Follow-up analysis inheriting previous params |
| `yahoohoo_options_dashboard` | ASCII options dashboard — GEX, key levels, dealer positioning |

The analysis engine classifies intent (comparison, risk, options, fundamentals, macro), selects a specialized Python program, fetches data, runs computation in a sandboxed subprocess, and optionally decomposes into child analyses. Results stay server-side; the host gets a compact summary and navigates deeper with `yahoohoo_peek`.

## Example

```
yahoohoo_analyze({
  "query": "compare QQQ vs IWM vs TLT performance and risk",
  "symbols": ["QQQ", "IWM", "TLT"]
})
```

```
Analysis objective: compare QQQ vs IWM vs TLT performance and risk
Scope: QQQ, IWM, TLT
Window: 2025-09-08 → 2026-03-07 (1wk)

Comparison snapshot:
- best total return: IWM (5.27%)
- lowest volatility: TLT (17.23%)
- shallowest drawdown: TLT (-4.85%)
- total return: IWM (5.27%) > QQQ (2.23%) > TLT (-1.66%)
- risk-adjusted return: IWM (0.16) > QQQ (0.07) > TLT (-0.10)

Pairwise:
- QQQ vs IWM: corr=0.65, rel.ret=-3.03%
- QQQ vs TLT: corr=-0.03, rel.ret=3.89%

[run: abc123] [confidence: 0.85] [intent: comparison]
```

## Docs

- [Architecture](docs/ARCHITECTURE.md) — three-layer design, data flow, transport strategy
- [Configuration](docs/CONFIG.md) — all env vars, HTTP mode, deployment
- [Security](docs/SECURITY.md) — sandbox threat model, what it does and doesn't protect against
- [ChatGPT Setup](docs/CHATGPT.md) — HTTP mode with HTTPS for remote hosts

## Caveats

- Yahoo Finance is unofficial. Data availability and response shapes can change.
- Options dealer-position outputs (GEX, gamma flip) are **proxies** based on OI and Black-Scholes gamma, not exact dealer inventory.
- CoinGecko free tier: ~10-30 calls/min without key, 30/min with demo key (`COINGECKO_API_KEY`).
- The Python sandbox blocks dangerous imports and applies resource limits. It is not VM-level isolation. See [Security](docs/SECURITY.md).

## Development

```bash
npm test               # 209 deterministic tests, no network
npm run test:live      # includes live Yahoo Finance integration
npm run smoke:sandbox  # smoke test the Python sandbox
```

## License

MIT
