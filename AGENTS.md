# Yahoohoo — Market Analysis MCP Server

You have access to Yahoohoo MCP tools for live market data analysis. Use the RLM pattern: compact returns, data stays server-side, iterate with peek/drill.

## Tool Inventory (11 tools)

**Analysis (RLM — compact returns, data in memory):**
- `yahoohoo_analyze` — Run analysis. Returns summary only (compact=true default). Full data stored server-side.
- `yahoohoo_peek` — Navigate stored analysis by dot-path. Use path="" for available keys.
- `yahoohoo_drill` — Follow-up analysis using previous run's params.

**Market Intelligence (compact text):**
- `yahoo_screener` — Predefined screens: day_gainers, day_losers, most_actives, undervalued_large_caps, growth_technology_stocks, most_shorted_stocks, small_cap_gainers, aggressive_small_caps
- `yahoo_trending` — Currently trending symbols
- `yahoo_insights` — Technical levels (support/resistance), outlook, analyst recs, significant developments

**Data:**
- `yahoo_search` — Find symbols by name/keyword
- `yahoo_quote` — Current price snapshots
- `yahoo_historical` — OHLCV bars (use summary=true for stats instead of raw bars)
- `yahoo_quote_summary` — Company fundamentals
- `yahoo_options` — Option chain snapshot (use expiries > 1 to sweep multiple expiry dates)

## RLM Workflow

1. `yahoohoo_analyze` → get compact summary + runId
2. `yahoohoo_peek` → explore specific metrics by dot-path
3. `yahoohoo_drill` → run follow-up with inherited params
4. Synthesize your understanding

## Peek Paths

After analyze, peek into stored data:
```
metrics.symbols.<SYM>.history            — bars, return, vol, drawdown
metrics.symbols.<SYM>.tail_risk          — VaR, CVaR, skew, kurtosis
metrics.symbols.<SYM>.drawdown           — max drawdown, peak/trough dates
metrics.symbols.<SYM>.options            — IV, walls, max pain, GEX, gamma flip
metrics.symbols.<SYM>.options.zero_dte   — 0DTE metrics (null if none)
metrics.symbols.<SYM>.options.expiry_sweep — per-expiry metrics array
metrics.symbols.<SYM>.options.dealer_profile — aggregate dealer-position proxy
metrics.cross_section.rankings           — by_total_return, by_sharpe, etc.
metrics.cross_section.leaders            — best in each category
metrics.comparisons.<SYM>_vs_SPY         — beta, correlation, capture ratios
metrics.pairwise                         — pairwise correlations
children                                 — child analysis nodes
```

## Key Points

- All analysis computation runs in a sandboxed Python subprocess (numpy/pandas)
- Data comes from Yahoo Finance (unofficial, no API key needed)
- Confidence scores range 0-1 based on data completeness and sandbox success
- Multi-timeframe: auto-runs daily + weekly when no interval specified
- Intent classification: comparison, risk, options, fundamentals, general
- Options analysis: auto-sweeps up to 5 expiries for options-intent queries
- Dealer profile: aggregate GEX, gamma flip, max-pain ladder across expiries (proxy, not exact inventory)
- 0DTE: detected when a same-day expiry exists relative to the analysis reference date
