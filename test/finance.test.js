import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YahooMarketData, normalizeStatements } from '../src/adapters/yahoo.js';
import { CoinGeckoData } from '../src/adapters/coingecko.js';
import { registerTools } from '../src/tools.js';
import { RecursiveMarketAnalyzer } from '../src/core/analyzer.js';
import { PythonSandbox } from '../src/sandbox/index.js';
import { loadConfig } from '../src/lib/config.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const provider = () => new YahooMarketData({ cacheTtlMs: 1000, logger });

describe('market data fidelity', () => {
  for (const [symbol, quoteType, delay] of [['AAPL', 'EQUITY', 0], ['SPY', 'ETF', 15], ['^GSPC', 'INDEX', null], ['BTC-USD', 'CRYPTOCURRENCY', 0]]) {
    it(`preserves ${symbol} timestamps, delays, missing values and zero volume`, async () => {
      const yahoo = provider();
      yahoo.yf = {
        quote: async () => ({ symbol, quoteType, regularMarketPrice: 10, regularMarketTime: new Date('2026-01-02T16:00:00Z'), exchangeDataDelayedBy: delay }),
        chart: async () => ({ quotes: [{ date: new Date('2026-01-02'), open: 0, high: null, close: 10, volume: 0 }, { date: new Date('2026-01-03'), close: null }] }),
      };
      const quote = (await yahoo.quote([symbol]))[symbol];
      assert.equal(quote.quoteType, quoteType);
      assert.equal(quote.regularMarketTime, '2026-01-02T16:00:00.000Z');
      assert.equal(quote.exchangeDataDelayedBy, delay);
      assert.ok(Date.parse(quote.retrievedAt));
      assert.equal(quote.marketCap, null);
      const bars = await yahoo.historical(symbol, { from: '2026-01-01', to: '2026-01-04', interval: '1d' });
      assert.equal(bars[0].volume, 0);
      assert.equal(bars[0].open, 0);
      assert.equal(bars[1].close, null);
      assert.equal(bars[1].date, '2026-01-03T00:00:00.000Z');
    });
  }

  it('filters non-Yahoo search results before applying the limit', async () => {
    const yahoo = provider();
    yahoo.yf = { search: async () => ({ quotes: [{ symbol: 'PRIVATE', isYahooFinance: false }, {}, { symbol: 'AAPL', isYahooFinance: true }] }) };
    assert.deepEqual((await yahoo.search('Apple', 1)).map((q) => q.symbol), ['AAPL']);
  });

  it('retains requested ETF and financial modules and reports missing ones as null', async () => {
    const yahoo = provider();
    yahoo.yf = { quoteSummary: async () => ({ fundProfile: { family: 'Vanguard' }, incomeStatementHistory: { statements: [{ revenue: 0 }] } }) };
    const summary = await yahoo.quoteSummary('VTI', ['fundProfile', 'incomeStatementHistory', 'balanceSheetHistory']);
    assert.equal(summary.fundProfile.family, 'Vanguard');
    assert.equal(summary.incomeStatementHistory.statements[0].revenue, 0);
    assert.equal(summary.balanceSheetHistory, null);
  });

  it('retains news timestamps, publisher, links, and ticker relevance', async () => {
    const yahoo = provider();
    yahoo.yf = { search: async (symbol, options) => {
      assert.equal(symbol, 'AAPL'); assert.equal(options.newsCount, 2); assert.equal(options.quotesCount, 0);
      return { news: [{ uuid: 'n1', title: 'Apple earnings', publisher: 'Reuters', link: 'https://example.com/news', providerPublishTime: new Date('2026-01-02T12:00:00Z'), relatedTickers: ['AAPL', 'MSFT'] }] };
    } };
    const news = await yahoo.news('AAPL', 2);
    assert.equal(news.articles[0].publishedAt, '2026-01-02T12:00:00.000Z');
    assert.equal(news.articles[0].publisher, 'Reuters');
    assert.deepEqual(news.articles[0].relatedTickers, ['AAPL', 'MSFT']);
  });

  it('normalizes all statement items, preserving zeros, currency and explicit missing data', () => {
    const rows = normalizeStatements({ timeseries: { result: [
      { meta: {}, annualNetIncome: [{ asOfDate: '2025-12-31', periodType: '12M', currencyCode: 'USD', reportedValue: { raw: 0 } }] },
      { annualTotalRevenue: [{ asOfDate: '2025-12-31', currencyCode: 'USD', reportedValue: { raw: 42 } }, { asOfDate: '2024-12-31', reportedValue: null }] },
    ] } }, 'annual');
    assert.equal(rows[1].netIncome, 0);
    assert.equal(rows[1].totalRevenue, 42);
    assert.equal(rows[1].lineItems.netIncome.currencyCode, 'USD');
    assert.equal(rows[0].totalRevenue, null);
    assert.throws(() => normalizeStatements({ timeseries: { error: { description: 'Not Found' } } }, 'annual'), /Not Found/);
  });

  for (const statement of ['financials', 'balance-sheet', 'cash-flow']) {
    for (const frequency of ['annual', 'quarterly', 'trailing']) {
      it(`routes ${frequency} ${statement} without dropping fields`, async () => {
        const yahoo = provider();
        yahoo.yf = { fundamentalsTimeSeries: async (_symbol, opts, moduleOpts) => {
          assert.equal(opts.module, statement); assert.equal(opts.type, frequency);
          assert.equal(opts.period2, '2026-01-03T00:00:00.000Z');
          const raw = { timeseries: { result: [{ [`${frequency}SomeNewLineItem`]: [{ asOfDate: '2025-12-31', reportedValue: { raw: 0 } }] }] } };
          const originalFetch = globalThis.fetch;
          try {
            globalThis.fetch = async () => new Response(JSON.stringify(raw));
            await moduleOpts.fetch('https://query1.finance.yahoo.com');
          } finally { globalThis.fetch = originalFetch; }
          return [{ someNewLineItem: undefined }];
        } };
        const result = await yahoo.financialStatement('AAPL', { statement, frequency, from: '2025-01-01', to: '2026-01-02' });
        assert.equal(result.periods[0].someNewLineItem, 0);
      });
    }
  }

  it('distinguishes no corporate statements from request failure for ETFs, indices and crypto', async () => {
    const yahoo = provider();
    yahoo.yf = { fundamentalsTimeSeries: async () => [] };
    for (const symbol of ['SPY', '^GSPC', 'BTC-USD']) {
      const result = await yahoo.financialStatement(symbol, { statement: 'financials', frequency: 'annual', from: '2025-01-01', to: '2026-01-01' });
      assert.equal(result.availability, 'no_data');
    }
  });

  for (const message of ['HTTP 429 Too Many Requests', 'Unauthorized crumb', 'Not Found', 'network timeout', 'Yahoo schema changed']) {
    it(`surfaces ${message} without caching failure`, async () => {
      const yahoo = provider(); let calls = 0;
      yahoo.yf = { chart: async () => { calls++; throw new Error(message); } };
      const request = () => yahoo.historical('AAPL', { from: '2025-01-01', to: '2025-02-01', interval: '1d' });
      await assert.rejects(request, { code: 'DATA_FETCH_ERROR' });
      await assert.rejects(request, { code: 'DATA_FETCH_ERROR' });
      assert.equal(calls, 2);
    });
  }

  it('keeps good quotes when one ticker fails', async () => {
    const yahoo = provider();
    yahoo.yf = { quote: async (symbol) => { if (symbol === 'BAD') throw new Error('Not Found'); return { symbol, regularMarketPrice: 10 }; } };
    const quotes = await yahoo.quote(['AAPL', 'BAD', 'AAPL']);
    assert.equal(quotes.AAPL.regularMarketPrice, 10);
    assert.equal(quotes.BAD.errorCode, 'DATA_FETCH_ERROR');
  });

  it('keeps multi-ticker analysis with explicit per-symbol failures', async () => {
    const yahoo = provider();
    yahoo.yf = {
      quote: async (symbol) => ({ symbol, regularMarketPrice: 11 }),
      chart: async (symbol) => { if (symbol === 'BAD') throw new Error('Not Found'); return { quotes: [1, 2, 3].map((day) => ({ date: new Date(`2026-01-0${day}`), close: 10 + day, high: 12, low: 9, open: 10, volume: 100 })) }; },
    };
    const config = loadConfig();
    const analyzer = new RecursiveMarketAnalyzer({ config, logger, marketData: yahoo, sandbox: new PythonSandbox({ config, logger }) });
    const result = await analyzer.analyze({ query: 'compare AAPL and BAD', symbols: ['AAPL', 'BAD'], from: '2026-01-01', to: '2026-01-05', reasoningMode: 'heuristic', maxDepth: 0 });
    assert.equal(result.metrics.symbols.AAPL.history.bars, 3);
    assert.equal(result.metrics.symbols.BAD.history.bars, 0);
    assert.ok(result.dataErrors.some((e) => e.symbol === 'BAD' && e.operation === 'historical'));
  });

  it('CoinGecko keeps provider timestamps and surfaces rate limiting', async () => {
    const cg = new CoinGeckoData({ logger, cacheTtlMs: 1000 });
    cg._fetch = async () => [{ id: 'bitcoin', symbol: 'btc', current_price: null, total_volume: 0, last_updated: '2026-01-02T10:00:00Z' }];
    const markets = await cg.markets();
    assert.equal(markets[0].last_updated, '2026-01-02T10:00:00Z');
    assert.equal(markets[0].price, null); assert.equal(markets[0].volume_24h, 0);
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response('', { status: 429 });
      await assert.rejects(CoinGeckoData.prototype._fetch.call(cg, '/global'), { code: 'RATE_LIMIT' });
    } finally { globalThis.fetch = originalFetch; }
  });

  it('returns MCP isError on provider failure and registers dedicated statement/news tools', async () => {
    const handlers = new Map();
    registerTools({ server: { registerTool(name, _meta, handler) { handlers.set(name, handler); }, registerPrompt() {}, registerResource() {} }, marketData: { news: async () => { throw new Error('Yahoo unavailable'); } }, cryptoData: {}, analyzer: {}, runStore: {}, config: { market: {}, recursion: {} } });
    for (const name of ['yahoo_news', 'yahoo_income_statement', 'yahoo_balance_sheet', 'yahoo_cash_flow']) assert.ok(handlers.has(name));
    assert.equal((await handlers.get('yahoo_news')({ symbol: 'AAPL', limit: 10 })).isError, true);
  });
});
