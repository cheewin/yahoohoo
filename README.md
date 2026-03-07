# Yahoohoo

Yahoohoo is an MCP server for market-data analysis. It uses Yahoo Finance for equities, ETFs, and options, CoinGecko for crypto data, and sandboxed Python for numerical computation. No API keys are required for the default setup.

It works with any MCP host, including Claude, Codex, ChatGPT, Cursor, and Windsurf. When the host supports MCP sampling, Yahoohoo can break larger requests into smaller analysis steps and synthesize the results. When it does not, Yahoohoo falls back to deterministic heuristics.

That recursive analysis looks like this in practice:

```text
compare QQQ vs IWM vs TLT performance and risk
├─ analyze QQQ
├─ analyze IWM
├─ analyze TLT
└─ synthesize cross-symbol comparisons and conclusions
```

## Install

```bash
npm install -g yahoohoo
yahoohoo --transport stdio
```

Requires Node 22+ and Python 3.

## Host setup

**Claude Code**

```bash
claude mcp add --transport stdio yahoohoo -- npx yahoohoo --transport stdio
```

**Codex**

```bash
codex mcp add yahoohoo -- npx yahoohoo --transport stdio
```

**Claude Desktop** — add this to `claude_desktop_config.json`:

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

**ChatGPT and other remote hosts** — run Yahoohoo in HTTP mode behind HTTPS. See [docs/CHATGPT.md](docs/CHATGPT.md).

## Available tools

### Market data (Yahoo Finance)

| Tool | What it does |
|------|-------------|
| `yahoo_search` | Find instruments by name or symbol |
| `yahoo_quote` | Current quotes for up to 20 symbols |
| `yahoo_historical` | OHLCV bars, or `summary=true` for computed stats |
| `yahoo_quote_summary` | Fundamentals and company profile |
| `yahoo_options` | Option chains with multi-expiry sweep |
| `yahoo_screener` | day_gainers, day_losers, most_actives, and other predefined screens |
| `yahoo_trending` | Trending symbols by region |
| `yahoo_insights` | Technical levels, outlook, and analyst recommendations |

### Crypto (CoinGecko)

| Tool | What it does |
|------|-------------|
| `crypto_trending` | Trending coins and categories |
| `crypto_global` | Total market cap, BTC/ETH dominance, and volume |
| `crypto_markets` | Top coins by market cap with price changes |
| `crypto_coin` | Detailed coin info, including supply, ATH/ATL, and categories |
| `crypto_search` | Search coins and get CoinGecko IDs |

Yahoo Finance also supports crypto tickers like `BTC-USD` and `ETH-USD` for quotes and historical data. The CoinGecko tools fill in the gaps with trending data, market-cap rankings, market-wide metrics, and richer coin metadata.

### Analysis tools

| Tool | What it does |
|------|-------------|
| `yahoohoo_analyze` | Run a sandboxed analysis and return a summary with a `runId` |
| `yahoohoo_peek` | Explore saved analysis results by dot-path |
| `yahoohoo_drill` | Run follow-up analysis while inheriting the previous run's parameters |
| `yahoohoo_options_dashboard` | Render an ASCII options dashboard with GEX, key levels, and dealer-positioning proxies |

The analysis engine classifies intent (for example comparison, risk, options, fundamentals, or macro), selects the matching Python program, fetches the required data, and runs the computation in a sandboxed subprocess. For more involved questions it can split the work into child analyses and store the detailed output server-side, while the host receives a compact summary and a `runId` for deeper inspection.

## Optional: `llm_query()` inside the sandbox

Sandbox Python code can call `llm_query("prompt")` to make a local LLM sub-call during computation ([RLM pattern](https://arxiv.org/abs/2512.24601)). Yahoohoo auto-detects which supported CLI is installed:

| CLI | Command | Install |
|-----|---------|---------|
| Claude | `claude -p "prompt"` | [claude.ai/code](https://claude.ai/code) |
| Codex | `codex exec "prompt"` | [github.com/openai/codex](https://github.com/openai/codex) |
| Gemini | `gemini -p "prompt"` | [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) |
| Copilot | `copilot -p -s "prompt"` | [github.com/github/copilot-cli](https://github.com/github/copilot-cli) |

Detection order is `claude`, then `codex`, then `gemini`, then `copilot`. Override it with:

```bash
YAHOOHOO_LLM_CLI=gemini    # force a specific CLI
YAHOOHOO_LLM_CLI=auto      # auto-detect (default)
YAHOOHOO_LLM_QUERY=false   # disable entirely
```

This only works when the CLI is available on the same machine as Yahoohoo. It does not apply when Yahoohoo is running remotely for a host like ChatGPT or Claude Desktop.

## Example

```json
yahoohoo_analyze({
  "query": "compare QQQ vs IWM vs TLT performance and risk",
  "symbols": ["QQQ", "IWM", "TLT"]
})
```

```text
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

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — three-layer design, data flow, and transport strategy
- [Configuration](docs/CONFIG.md) — environment variables, HTTP mode, and deployment
- [Security](docs/SECURITY.md) — sandbox threat model and limitations
- [ChatGPT setup](docs/CHATGPT.md) — running in HTTP mode for remote hosts

## Caveats

- Yahoo Finance is unofficial, so data availability and response shapes can change.
- Options dealer-position outputs such as GEX and gamma flip are estimates derived from open interest and Black-Scholes gamma, not direct dealer inventory.
- CoinGecko's free tier is limited to roughly 10-30 calls per minute without a key and 30 calls per minute with a demo key (`COINGECKO_API_KEY`).
- The Python sandbox blocks dangerous imports and applies resource limits, but it is not VM-level isolation. See [Security](docs/SECURITY.md) for details.

## Development

```bash
npm run check         # syntax-check source files
npm test              # 213 deterministic tests, no network
npm run test:live     # includes live Yahoo Finance integration
npm run smoke:sandbox # smoke test the Python sandbox
```

## License

MIT
