import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YahooMarketData } from '../src/adapters/yahoo.js';
import { RecursiveMarketAnalyzer } from '../src/core/analyzer.js';
import { loadConfig } from '../src/lib/config.js';
import { createLogger } from '../src/lib/logger.js';
import { PythonSandbox } from '../src/sandbox/index.js';

const liveEnabled = process.env.YAHOOHOO_TEST_LIVE === '1';
const config = loadConfig();
const logger = createLogger('error');

function isoDay(offsetDays) {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe('live Yahoo Finance integration', { skip: !liveEnabled }, () => {
  it('fetches live search, quote, and history data for AAPL', { timeout: 30_000 }, async () => {
    const marketData = new YahooMarketData({
      cacheTtlMs: config.market.cacheTtlMs,
      logger,
    });

    const searchResults = await marketData.search('AAPL', 5);
    assert.ok(searchResults.some((item) => item.symbol === 'AAPL'));

    const quotes = await marketData.quote(['AAPL']);
    assert.equal(quotes.AAPL.symbol, 'AAPL');
    assert.equal(quotes.AAPL.error, undefined);
    assert.ok(quotes.AAPL.regularMarketPrice != null);

    const history = await marketData.historical('AAPL', {
      from: isoDay(-30),
      to: isoDay(0),
      interval: '1d',
    });
    assert.ok(history.length >= 5);
    assert.ok(history.every((row) => typeof row.date === 'string'));
  });

  it('keeps partial analysis results when one live symbol fails', { timeout: 45_000 }, async () => {
    const marketData = new YahooMarketData({
      cacheTtlMs: config.market.cacheTtlMs,
      logger,
    });
    const sandbox = new PythonSandbox({ config, logger });
    const analyzer = new RecursiveMarketAnalyzer({
      config,
      logger,
      marketData,
      sandbox,
    });

    const result = await analyzer.analyze({
      query: 'compare AAPL vs YHOOHOOINVALID',
      symbols: ['AAPL', 'YHOOHOOINVALID'],
      from: isoDay(-30),
      to: isoDay(0),
      reasoningMode: 'heuristic',
      maxDepth: 0,
    });

    assert.equal(result.kind, 'analysis_node');
    assert.ok(result.metrics.symbols.AAPL.history.bars >= 5);
    assert.equal(result.metrics.symbols.YHOOHOOINVALID.history.bars, 0);
    assert.ok(result.summary.includes('Comparison snapshot'));
  });
});
