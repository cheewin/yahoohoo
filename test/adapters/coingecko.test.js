import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CoinGeckoData } from '../../src/adapters/coingecko.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

describe('CoinGeckoData', () => {
  it('constructs without API key', () => {
    const cg = new CoinGeckoData({ cacheTtlMs: 5000, logger });
    assert.ok(cg);
    assert.equal(cg.apiKey, null);
  });

  it('constructs with API key', () => {
    const cg = new CoinGeckoData({ cacheTtlMs: 5000, logger, apiKey: 'test-key' });
    assert.equal(cg.apiKey, 'test-key');
  });

  it('has all expected methods', () => {
    const cg = new CoinGeckoData({ cacheTtlMs: 5000, logger });
    assert.equal(typeof cg.prices, 'function');
    assert.equal(typeof cg.markets, 'function');
    assert.equal(typeof cg.trending, 'function');
    assert.equal(typeof cg.global, 'function');
    assert.equal(typeof cg.search, 'function');
    assert.equal(typeof cg.ohlc, 'function');
    assert.equal(typeof cg.coinInfo, 'function');
  });

  it('caches results', async () => {
    const cg = new CoinGeckoData({ cacheTtlMs: 60000, logger });
    let fetchCount = 0;
    const origFetch = cg._fetch.bind(cg);
    cg._fetch = async (...args) => {
      fetchCount++;
      return { coins: [], categories: [] };
    };
    await cg.trending();
    await cg.trending();
    assert.equal(fetchCount, 1, 'second call should use cache');
  });
});
