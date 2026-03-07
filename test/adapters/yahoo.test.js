import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YahooMarketData } from '../../src/adapters/yahoo.js';

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe('YahooMarketData historical range normalization', () => {
  it('treats date-only end dates as inclusive', async () => {
    const yahoo = new YahooMarketData({ cacheTtlMs: 1000, logger });
    let capturedOptions;
    yahoo.yf = {
      chart: async (_symbol, options) => {
        capturedOptions = options;
        return { quotes: [] };
      },
    };

    await yahoo.historical('QQQ', {
      from: '2026-03-01',
      to: '2026-03-06',
      interval: '1d',
    });

    assert.equal(capturedOptions.period1, '2026-03-01');
    assert.equal(capturedOptions.period2, '2026-03-07T00:00:00.000Z');
  });

  it('preserves explicit timestamp end dates', async () => {
    const yahoo = new YahooMarketData({ cacheTtlMs: 1000, logger });
    let capturedOptions;
    yahoo.yf = {
      chart: async (_symbol, options) => {
        capturedOptions = options;
        return { quotes: [] };
      },
    };

    await yahoo.historical('QQQ', {
      from: '2026-03-01',
      to: '2026-03-06T21:00:01.000Z',
      interval: '1d',
    });

    assert.equal(capturedOptions.period2, '2026-03-06T21:00:01.000Z');
  });
});

describe('YahooMarketData options normalization', () => {
  it('extracts calls and puts from the nested options chain payload', async () => {
    const yahoo = new YahooMarketData({ cacheTtlMs: 1000, logger });
    yahoo.yf = {
      options: async () => ({
        underlyingSymbol: 'QQQ',
        expirationDates: [new Date('2026-03-09T00:00:00.000Z')],
        strikes: [595, 600, 605],
        quote: { symbol: 'QQQ', regularMarketPrice: 600 },
        options: [{
          expirationDate: new Date('2026-03-09T00:00:00.000Z'),
          hasMiniOptions: false,
          calls: [{ strike: 600, openInterest: 100, volume: 20, contractSize: 'REGULAR', impliedVolatility: 0.25 }],
          puts: [{ strike: 595, openInterest: 120, volume: 25, contractSize: 'REGULAR', impliedVolatility: 0.27 }],
        }],
      }),
    };

    const chain = await yahoo.options('QQQ');
    assert.equal(chain.calls.length, 1);
    assert.equal(chain.puts.length, 1);
    assert.equal(chain.activeExpirationDate, '2026-03-09T00:00:00.000Z');
    assert.equal(chain.quote.regularMarketPrice, 600);
  });
});
