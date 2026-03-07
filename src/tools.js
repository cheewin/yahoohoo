import { z } from 'zod';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VALID_INTERVALS } from './lib/dates.js';

function textResult(text, structuredContent) {
  if (structuredContent !== undefined) {
    return { content: [{ type: 'text', text }], structuredContent };
  }
  return { content: [{ type: 'text', text }] };
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function getByPath(obj, path) {
  if (!path) return obj;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function computeBarStats(bars) {
  if (!bars.length) return { bars: 0 };
  const closes = bars.map((b) => b.close).filter((c) => c != null);
  const volumes = bars.map((b) => b.volume).filter((v) => v != null);
  const highs = bars.map((b) => b.high).filter((h) => h != null);
  const lows = bars.map((b) => b.low).filter((l) => l != null);
  const first = bars[0];
  const last = bars[bars.length - 1];
  const totalReturn = closes.length >= 2 ? (closes[closes.length - 1] - closes[0]) / closes[0] : null;
  const avgClose = closes.reduce((a, b) => a + b, 0) / closes.length;
  const avgVolume = volumes.length ? Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length) : null;
  // daily return std as volatility proxy
  const dailyReturns = [];
  for (let i = 1; i < closes.length; i++) {
    dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const meanReturn = dailyReturns.length ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const variance = dailyReturns.length
    ? dailyReturns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / dailyReturns.length
    : 0;
  const dailyVol = Math.sqrt(variance);
  return {
    bars: bars.length,
    firstDate: first.date,
    lastDate: last.date,
    openFirst: first.open,
    closeLast: last.close,
    high: highs.length ? Math.max(...highs) : null,
    low: lows.length ? Math.min(...lows) : null,
    totalReturn: totalReturn != null ? +(totalReturn * 100).toFixed(2) : null,
    avgClose: +avgClose.toFixed(2),
    avgVolume,
    dailyVolatility: +(dailyVol * 100).toFixed(3),
    annualizedVol: +(dailyVol * Math.sqrt(252) * 100).toFixed(2),
  };
}

const SCREENER_IDS = [
  'day_gainers', 'day_losers', 'most_actives',
  'undervalued_large_caps', 'growth_technology_stocks',
  'most_shorted_stocks', 'small_cap_gainers', 'aggressive_small_caps',
];

export function registerTools({ server, marketData, analyzer, runStore, config }) {
  // ── Data Tools ──────────────────────────────────────────────────────

  server.registerTool(
    'yahoo_search',
    {
      title: 'Yahoo Search',
      description: 'Search Yahoo Finance instruments by name, symbol, or keyword.',
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(20).default(8),
      }),
    },
    async ({ query, limit }) => {
      const results = await marketData.search(query, limit);
      return textResult(pretty(results), { query, results });
    },
  );

  server.registerTool(
    'yahoo_quote',
    {
      title: 'Yahoo Quote',
      description: 'Fetch current quote snapshots for one or more symbols.',
      inputSchema: z.object({
        symbols: z.array(z.string().min(1)).min(1).max(20),
      }),
    },
    async ({ symbols }) => {
      const quotes = await marketData.quote(symbols);
      return textResult(pretty(quotes), quotes);
    },
  );

  server.registerTool(
    'yahoo_historical',
    {
      title: 'Yahoo Historical',
      description:
        'Fetch historical OHLCV bars from Yahoo Finance. Use summary=true to get computed statistics instead of raw bars (saves context).',
      inputSchema: z.object({
        symbol: z.string().min(1),
        from: z.string().optional(),
        to: z.string().optional(),
        interval: z.enum([...VALID_INTERVALS]).optional(),
        summary: z.boolean().default(false).describe('Return computed stats instead of raw bars'),
      }),
    },
    async ({ symbol, from, to, interval, summary }) => {
      const bars = await marketData.historical(symbol.toUpperCase(), {
        from: from || new Date(Date.now() - config.market.defaultLookbackDays * 86400_000).toISOString().slice(0, 10),
        to: to || new Date().toISOString().slice(0, 10),
        interval: interval || '1d',
      });
      if (summary) {
        const stats = computeBarStats(bars);
        stats.symbol = symbol.toUpperCase();
        return textResult(pretty(stats), stats);
      }
      return textResult(pretty(bars), { symbol: symbol.toUpperCase(), bars });
    },
  );

  server.registerTool(
    'yahoo_quote_summary',
    {
      title: 'Yahoo Quote Summary',
      description: 'Fetch company profile and valuation/fundamental summary modules.',
      inputSchema: z.object({
        symbol: z.string().min(1),
        modules: z.array(z.string().min(1)).optional(),
      }),
    },
    async ({ symbol, modules }) => {
      const summary = await marketData.quoteSummary(
        symbol.toUpperCase(),
        modules?.length ? modules : config.market.quoteSummaryModules,
      );
      return textResult(pretty(summary), summary);
    },
  );

  server.registerTool(
    'yahoo_options',
    {
      title: 'Yahoo Options',
      description: 'Fetch an option chain snapshot from Yahoo Finance.',
      inputSchema: z.object({
        symbol: z.string().min(1),
        date: z.string().optional(),
      }),
    },
    async ({ symbol, date }) => {
      const chain = await marketData.options(symbol.toUpperCase(), date);
      return textResult(pretty(chain), chain);
    },
  );

  // ── Market Intelligence Tools ───────────────────────────────────────

  server.registerTool(
    'yahoo_screener',
    {
      title: 'Yahoo Screener',
      description: `Run a predefined Yahoo Finance screener. Available screens: ${SCREENER_IDS.join(', ')}.`,
      inputSchema: z.object({
        screen: z.enum(SCREENER_IDS),
        count: z.number().int().min(1).max(50).default(10),
      }),
    },
    async ({ screen, count }) => {
      const result = await marketData.screener(screen, count);
      const lines = result.quotes.map(
        (q) =>
          `${q.symbol} ${q.regularMarketPrice ?? '?'} ${q.regularMarketChangePercent != null ? (q.regularMarketChangePercent >= 0 ? '+' : '') + q.regularMarketChangePercent.toFixed(2) + '%' : ''} vol=${q.regularMarketVolume ?? '?'} cap=${q.marketCap ? (q.marketCap / 1e9).toFixed(1) + 'B' : '?'}`,
      );
      return textResult(`${screen} (${result.total} total, showing ${result.quotes.length}):\n${lines.join('\n')}`);
    },
  );

  server.registerTool(
    'yahoo_trending',
    {
      title: 'Yahoo Trending',
      description: 'Get currently trending symbols on Yahoo Finance.',
      inputSchema: z.object({
        region: z.string().default('US'),
        count: z.number().int().min(1).max(30).default(10),
      }),
    },
    async ({ region, count }) => {
      const symbols = await marketData.trending(region, count);
      return textResult(`Trending (${region}): ${symbols.join(', ')}`);
    },
  );

  server.registerTool(
    'yahoo_insights',
    {
      title: 'Yahoo Insights',
      description:
        'Get analyst insights for a symbol: technical levels (support/resistance), short/mid/long-term outlook, valuation assessment, analyst recommendation, and recent significant developments.',
      inputSchema: z.object({
        symbol: z.string().min(1),
      }),
    },
    async ({ symbol }) => {
      const ins = await marketData.insights(symbol.toUpperCase());
      if (ins.error) return textResult(`Insights unavailable for ${symbol}: ${ins.error}`);

      const parts = [`Insights: ${ins.symbol}`];
      if (ins.technicals) {
        parts.push(
          `Technical levels: support=${ins.technicals.support ?? '?'} resistance=${ins.technicals.resistance ?? '?'} stopLoss=${ins.technicals.stopLoss ?? '?'}`,
        );
      }
      if (ins.outlook) {
        const fmt = (o) => (o ? `${o.direction}(${o.score})` : '?');
        parts.push(`Outlook: short=${fmt(ins.outlook.shortTerm)} mid=${fmt(ins.outlook.midTerm)} long=${fmt(ins.outlook.longTerm)}`);
      }
      if (ins.valuation) {
        parts.push(`Valuation: ${ins.valuation.description ?? '?'} (${ins.valuation.relativeValue ?? '?'}, discount=${ins.valuation.discount ?? '?'})`);
      }
      if (ins.recommendation) {
        parts.push(`Recommendation: ${ins.recommendation.rating} target=${ins.recommendation.targetPrice ?? '?'} (${ins.recommendation.provider})`);
      }
      if (ins.sigDevs.length) {
        parts.push('Recent developments:');
        for (const d of ins.sigDevs) parts.push(`  ${d.date}: ${d.headline}`);
      }
      return textResult(parts.join('\n'));
    },
  );

  // ── Analysis Tools (RLM pattern) ────────────────────────────────────

  server.registerTool(
    'yahoohoo_analyze',
    {
      title: 'Yahoohoo Recursive Analysis',
      description:
        'Perform recursive, sandboxed market analysis. Returns a compact summary by default (full data stored server-side, accessible via yahoohoo_peek). Set compact=false for full structured output.',
      inputSchema: z.object({
        query: z.string().min(1),
        symbols: z.array(z.string().min(1)).max(6).optional(),
        benchmark: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        interval: z.enum([...VALID_INTERVALS]).optional(),
        reasoningMode: z.enum(['auto', 'sampling', 'heuristic']).default('auto'),
        includeFundamentals: z.boolean().default(false),
        includeOptions: z.boolean().default(false),
        maxDepth: z.number().int().min(0).max(4).default(config.recursion.maxDepth),
        compact: z.boolean().default(true).describe('Return summary only (true) or full structured data (false)'),
      }),
    },
    async ({
      query,
      symbols,
      benchmark,
      from,
      to,
      interval,
      reasoningMode,
      includeFundamentals,
      includeOptions,
      maxDepth,
      compact,
    }, ctx) => {
      const analysis = await analyzer.analyze({
        query,
        symbols,
        benchmark,
        from,
        to,
        interval,
        reasoningMode,
        includeFundamentals,
        includeOptions,
        maxDepth,
        ctx,
      });

      const runId = runStore.save(analysis);
      analysis.runId = runId;

      if (compact) {
        const meta = [
          `[run: ${runId}]`,
          `[confidence: ${analysis.confidence}]`,
          `[intent: ${analysis.intent?.primary ?? 'general'}]`,
          `[symbols: ${(analysis.symbols || []).join(', ')}]`,
          `[window: ${analysis.range?.from ?? '?'} → ${analysis.range?.to ?? '?'}]`,
          analysis.children?.length ? `[children: ${analysis.children.length}]` : null,
        ].filter(Boolean);
        return textResult(`${analysis.summary}\n\n${meta.join(' ')}`);
      }

      return textResult(analysis.summary, analysis);
    },
  );

  server.registerTool(
    'yahoohoo_peek',
    {
      title: 'Yahoohoo Peek',
      description:
        'Peek into a stored analysis run. Use dot-path to navigate: "metrics.symbols.QQQ.history", "metrics.cross_section.rankings", "children.0.summary", etc. Use path="" to see available top-level keys.',
      inputSchema: z.object({
        runId: z.string().min(1),
        path: z.string().default('').describe('Dot-separated path into the analysis object'),
      }),
    },
    async ({ runId, path }) => {
      const run = runStore.get(runId);
      if (!run) return textResult(`Run ${runId} not found. Use yahoohoo_analyze first.`);
      const analysis = run.analysis;
      if (!path) {
        const keys = Object.keys(analysis);
        const symbolList = analysis.symbols?.join(', ') || '?';
        return textResult(
          `Run ${runId} — ${analysis.question}\nSymbols: ${symbolList}\nAvailable keys: ${keys.join(', ')}\n\nTip: peek into "metrics.symbols.<SYM>" for per-symbol data, "metrics.cross_section" for rankings, "metrics.comparisons" for benchmark stats, "children" for child analyses.`,
        );
      }
      const value = getByPath(analysis, path);
      if (value === undefined) return textResult(`Path "${path}" not found in run ${runId}.`);
      const text = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
      // Truncate if too large to keep context clean
      if (text.length > 4000) {
        const keys = typeof value === 'object' && value !== null ? Object.keys(value) : [];
        return textResult(
          `Path "${path}" is large (${text.length} chars). Sub-keys: ${keys.join(', ') || 'N/A'}\nFirst 2000 chars:\n${text.slice(0, 2000)}...`,
        );
      }
      return textResult(text);
    },
  );

  server.registerTool(
    'yahoohoo_drill',
    {
      title: 'Yahoohoo Drill',
      description:
        'Run a follow-up analysis on a stored run. Inherits symbols, date range, and benchmark from the previous run. Override symbols to focus on a subset.',
      inputSchema: z.object({
        runId: z.string().min(1),
        query: z.string().min(1).describe('The follow-up question'),
        symbols: z.array(z.string().min(1)).max(6).optional().describe('Override symbols (default: inherit from previous run)'),
        includeFundamentals: z.boolean().default(false),
        includeOptions: z.boolean().default(false),
      }),
    },
    async ({ runId, query, symbols, includeFundamentals, includeOptions }, ctx) => {
      const run = runStore.get(runId);
      if (!run) return textResult(`Run ${runId} not found.`);
      const prev = run.analysis;

      const analysis = await analyzer.analyze({
        query,
        symbols: symbols || prev.symbols,
        benchmark: prev.benchmark,
        from: prev.range?.from,
        to: prev.range?.to,
        interval: prev.interval,
        reasoningMode: 'auto',
        includeFundamentals,
        includeOptions,
        maxDepth: 1,
        ctx,
      });

      const newRunId = runStore.save(analysis);
      analysis.runId = newRunId;

      const meta = [
        `[run: ${newRunId}]`,
        `[drilled from: ${runId}]`,
        `[confidence: ${analysis.confidence}]`,
        `[intent: ${analysis.intent?.primary ?? 'general'}]`,
      ];
      return textResult(`${analysis.summary}\n\n${meta.join(' ')}`);
    },
  );

  // ── Prompt ──────────────────────────────────────────────────────────

  server.registerPrompt(
    'market_study_prompt',
    {
      title: 'Market Study Prompt',
      description: 'Generate a reusable prompt for host-side analysis with Yahoohoo tools.',
      argsSchema: {
        objective: z.string(),
        symbols: z.string().optional(),
      },
    },
    ({ objective, symbols }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Use Yahoohoo to analyze this market question: ${objective}${symbols ? `\nSymbols: ${symbols}` : ''}. Prefer yahoohoo_analyze first, then drill down with direct yahoo_* tools if needed.`,
          },
        },
      ],
    }),
  );

  // ── MCP Resources — saved analysis runs ─────────────────────────────

  server.registerResource(
    'saved_analyses',
    new ResourceTemplate('yahoohoo://analysis/{id}', {
      list: async () => ({
        resources: runStore.list().map((run) => ({
          uri: `yahoohoo://analysis/${run.id}`,
          name: `${run.symbols.join(', ')}: ${run.query}`,
          mimeType: 'application/json',
          description: `Analysis from ${run.createdAt}`,
        })),
      }),
    }),
    {
      title: 'Saved Analysis Run',
      description: 'A completed yahoohoo_analyze result.',
      mimeType: 'application/json',
    },
    (uri, { id }) => {
      const run = runStore.get(id);
      if (!run) {
        return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: `Analysis ${id} not found.` }] };
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(run.analysis, null, 2),
        }],
      };
    },
  );
}
