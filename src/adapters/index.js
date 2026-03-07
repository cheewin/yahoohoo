import { YahooMarketData } from './yahoo.js';

const PROVIDERS = {
  yahoo: YahooMarketData,
};

/**
 * Create a market data provider based on config.
 *
 * @param {{provider?: string, cacheTtlMs: number, logger: object}} options
 * @returns {import('./base.js').MarketDataProvider}
 */
export function createMarketDataProvider({ provider = 'yahoo', cacheTtlMs, logger }) {
  const Provider = PROVIDERS[provider];
  if (!Provider) {
    const available = Object.keys(PROVIDERS).join(', ');
    throw new Error(`Unknown data provider "${provider}". Available: ${available}`);
  }
  return new Provider({ cacheTtlMs, logger });
}

export { MarketDataProvider } from './base.js';
export { YahooMarketData } from './yahoo.js';
