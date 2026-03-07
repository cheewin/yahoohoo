import { z } from 'zod';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VALID_INTERVALS } from './lib/dates.js';

function textResult(text, structuredContent) {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
  };
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

export function registerTools({ server, marketData, analyzer, runStore, config }) {
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
      description: 'Fetch historical OHLCV bars from Yahoo Finance.',
      inputSchema: z.object({
        symbol: z.string().min(1),
        from: z.string().optional(),
        to: z.string().optional(),
        interval: z.enum([...VALID_INTERVALS]).optional(),
      }),
    },
    async ({ symbol, from, to, interval }) => {
      const bars = await marketData.historical(symbol.toUpperCase(), {
        from: from || new Date(Date.now() - config.market.defaultLookbackDays * 86400_000).toISOString().slice(0, 10),
        to: to || new Date().toISOString().slice(0, 10),
        interval: interval || '1d',
      });
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

  server.registerTool(
    'yahoohoo_analyze',
    {
      title: 'Yahoohoo Recursive Analysis',
      description: 'Perform recursive, sandboxed market analysis using Yahoo Finance data. Uses host MCP sampling when available and falls back to deterministic summarization when it is not.',
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

      return textResult(analysis.summary, analysis);
    },
  );

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

  // MCP Resources — saved analysis runs
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
