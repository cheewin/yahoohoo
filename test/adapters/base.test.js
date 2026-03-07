import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MarketDataProvider } from '../../src/adapters/base.js';
import { YahooMarketData } from '../../src/adapters/yahoo.js';
import { createMarketDataProvider } from '../../src/adapters/index.js';

describe('MarketDataProvider', () => {
  it('throws on unimplemented methods', async () => {
    const provider = new MarketDataProvider();
    await assert.rejects(() => provider.search('test'), /not implemented/);
    await assert.rejects(() => provider.quote(['AAPL']), /not implemented/);
    await assert.rejects(() => provider.historical('AAPL', {}), /not implemented/);
    await assert.rejects(() => provider.quoteSummary('AAPL', []), /not implemented/);
    await assert.rejects(() => provider.options('AAPL'), /not implemented/);
  });
});

describe('YahooMarketData extends MarketDataProvider', () => {
  it('is an instance of MarketDataProvider', () => {
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const yahoo = new YahooMarketData({ cacheTtlMs: 1000, logger });
    assert.ok(yahoo instanceof MarketDataProvider);
  });
});

describe('createMarketDataProvider', () => {
  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

  it('creates yahoo provider by default', () => {
    const provider = createMarketDataProvider({ cacheTtlMs: 1000, logger });
    assert.ok(provider instanceof YahooMarketData);
    assert.ok(provider instanceof MarketDataProvider);
  });

  it('creates yahoo provider when specified', () => {
    const provider = createMarketDataProvider({ provider: 'yahoo', cacheTtlMs: 1000, logger });
    assert.ok(provider instanceof YahooMarketData);
  });

  it('throws for unknown provider', () => {
    assert.throws(
      () => createMarketDataProvider({ provider: 'unknown', cacheTtlMs: 1000, logger }),
      /Unknown data provider/,
    );
  });
});
