import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RecursiveMarketAnalyzer } from '../../src/core/analyzer.js';
import { PythonSandbox } from '../../src/sandbox/index.js';
import { loadConfig } from '../../src/lib/config.js';
import { createLogger } from '../../src/lib/logger.js';

const config = loadConfig();
const logger = createLogger('error');

function makeMockMarketData(fixture = {}) {
  const bars = fixture.bars || [
    { date: '2026-01-01T00:00:00Z', close: 100, open: 99, high: 101, low: 98, volume: 1000000 },
    { date: '2026-01-02T00:00:00Z', close: 102, open: 100, high: 103, low: 99, volume: 1100000 },
    { date: '2026-01-03T00:00:00Z', close: 98, open: 102, high: 102, low: 97, volume: 900000 },
    { date: '2026-01-06T00:00:00Z', close: 105, open: 98, high: 106, low: 97, volume: 1200000 },
    { date: '2026-01-07T00:00:00Z', close: 110, open: 105, high: 111, low: 104, volume: 1300000 },
  ];

  return {
    search: async () => [{ symbol: 'AAPL' }],
    quote: async (symbols) => {
      const entries = symbols.map((s) => [s, {
        symbol: s,
        regularMarketPrice: 110,
        shortName: `${s} Inc.`,
        currency: 'USD',
      }]);
      return Object.fromEntries(entries);
    },
    historical: async () => bars,
    quoteSummary: async (symbol) => ({
      symbol,
      price: { marketCap: 3000000000000 },
      summaryDetail: { trailingPE: 28 },
    }),
    options: async (symbol) => ({
      underlyingSymbol: symbol,
      expirationDates: ['2026-04-01'],
      strikes: [100, 105, 110],
      calls: [
        { strike: 110, impliedVolatility: 0.3, openInterest: 5000 },
      ],
      puts: [
        { strike: 110, impliedVolatility: 0.32, openInterest: 3000 },
      ],
      quote: null,
    }),
  };
}

describe('RecursiveMarketAnalyzer', () => {
  it('analyzes a single symbol in heuristic mode', async () => {
    const sandbox = new PythonSandbox({ config, logger });
    const marketData = makeMockMarketData();
    const analyzer = new RecursiveMarketAnalyzer({ config, logger, marketData, sandbox });

    const result = await analyzer.analyze({
      query: 'analyze AAPL',
      symbols: ['AAPL'],
      reasoningMode: 'heuristic',
      maxDepth: 0,
    });

    assert.equal(result.kind, 'analysis_node');
    assert.deepEqual(result.symbols, ['AAPL']);
    assert.ok(result.summary.length > 0);
    assert.ok(result.metrics.symbols.AAPL);
    assert.equal(result.sampling.ok, false);
    assert.equal(result.children.length, 0);
  });

  it('analyzes multiple symbols with children', async () => {
    const sandbox = new PythonSandbox({ config, logger });
    const marketData = makeMockMarketData();
    const analyzer = new RecursiveMarketAnalyzer({ config, logger, marketData, sandbox });

    const result = await analyzer.analyze({
      query: 'compare AAPL vs MSFT',
      symbols: ['AAPL', 'MSFT'],
      reasoningMode: 'heuristic',
      maxDepth: 1,
    });

    assert.equal(result.kind, 'analysis_node');
    assert.equal(result.metrics.cross_section.symbol_count, 2);
    assert.ok(Array.isArray(result.metrics.cross_section.rankings.by_total_return));
    assert.ok(result.children.length > 0);
    for (const child of result.children) {
      assert.equal(child.kind, 'analysis_node');
      assert.ok(child.summary.length > 0);
    }
  });

  it('resolves symbols from query when none provided', async () => {
    const sandbox = new PythonSandbox({ config, logger });
    const marketData = makeMockMarketData();
    const analyzer = new RecursiveMarketAnalyzer({ config, logger, marketData, sandbox });

    const result = await analyzer.analyze({
      query: 'How is NVDA performing?',
      reasoningMode: 'heuristic',
      maxDepth: 0,
    });

    assert.equal(result.kind, 'analysis_node');
    assert.ok(result.symbols.includes('NVDA'));
  });

  it('falls back to search when no tickers in query', async () => {
    const sandbox = new PythonSandbox({ config, logger });
    const marketData = makeMockMarketData();
    const analyzer = new RecursiveMarketAnalyzer({ config, logger, marketData, sandbox });

    const result = await analyzer.analyze({
      query: 'how is apple stock doing',
      reasoningMode: 'heuristic',
      maxDepth: 0,
    });

    assert.equal(result.kind, 'analysis_node');
    assert.ok(result.symbols.length > 0);
  });

  it('throws when no symbols can be resolved', async () => {
    const sandbox = new PythonSandbox({ config, logger });
    const marketData = {
      ...makeMockMarketData(),
      search: async () => [],
    };
    const analyzer = new RecursiveMarketAnalyzer({ config, logger, marketData, sandbox });

    await assert.rejects(
      () => analyzer.analyze({
        query: 'what is going on',
        reasoningMode: 'heuristic',
        maxDepth: 0,
      }),
      /Could not infer any symbols/,
    );
  });

  it('includes fundamentals when requested', async () => {
    const sandbox = new PythonSandbox({ config, logger });
    const marketData = makeMockMarketData();
    const analyzer = new RecursiveMarketAnalyzer({ config, logger, marketData, sandbox });

    const result = await analyzer.analyze({
      query: 'analyze AAPL valuation',
      symbols: ['AAPL'],
      includeFundamentals: true,
      reasoningMode: 'heuristic',
      maxDepth: 0,
    });

    assert.ok(result.metrics.symbols.AAPL.fundamentals);
  });

  it('includes confidence score in results', async () => {
    const sandbox = new PythonSandbox({ config, logger });
    const marketData = makeMockMarketData();
    const analyzer = new RecursiveMarketAnalyzer({ config, logger, marketData, sandbox });

    const result = await analyzer.analyze({
      query: 'analyze AAPL',
      symbols: ['AAPL'],
      reasoningMode: 'heuristic',
      maxDepth: 0,
    });

    assert.equal(typeof result.confidence, 'number');
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  });

  it('uses intent-aware programs for child analyses', async () => {
    const sandbox = new PythonSandbox({ config, logger });
    const marketData = makeMockMarketData();
    const analyzer = new RecursiveMarketAnalyzer({ config, logger, marketData, sandbox });

    const result = await analyzer.analyze({
      query: 'compare AAPL vs MSFT risk and volatility',
      symbols: ['AAPL', 'MSFT'],
      reasoningMode: 'heuristic',
      maxDepth: 1,
    });

    assert.ok(result.children.length > 0);
    for (const child of result.children) {
      assert.ok(child.program, 'child has program field');
      assert.ok(child.intent, 'child has intent field');
    }
  });

  it('handles sandbox failure gracefully', async () => {
    const brokenSandbox = {
      run: async () => { throw new Error('Python not found'); },
    };
    const marketData = makeMockMarketData();
    const analyzer = new RecursiveMarketAnalyzer({
      config, logger, marketData, sandbox: brokenSandbox,
    });

    const result = await analyzer.analyze({
      query: 'analyze AAPL',
      symbols: ['AAPL'],
      reasoningMode: 'heuristic',
      maxDepth: 0,
    });

    assert.equal(result.kind, 'analysis_node');
    assert.ok(result.metrics._sandboxError);
    assert.ok(result.summary.length > 0);
  });
});
