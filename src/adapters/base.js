/**
 * MarketDataProvider — abstract interface for market data sources.
 *
 * All concrete providers (Yahoo, Alpha Vantage, Polygon, etc.) must
 * implement these five methods.
 */
export class MarketDataProvider {
  /**
   * @param {string} query
   * @param {number} limit
   * @returns {Promise<Array<{symbol: string, shortname?: string, exchange?: string, quoteType?: string}>>}
   */
  async search(_query, _limit = 10) {
    throw new Error('search() not implemented');
  }

  /**
   * @param {string[]} symbols
   * @returns {Promise<Record<string, object>>}
   */
  async quote(_symbols) {
    throw new Error('quote() not implemented');
  }

  /**
   * @param {string} symbol
   * @param {{from: string, to: string, interval: string}} options
   * @returns {Promise<Array<{date: string, open: number, high: number, low: number, close: number, volume: number, adjClose?: number}>>}
   */
  async historical(_symbol, _options) {
    throw new Error('historical() not implemented');
  }

  /**
   * @param {string} symbol
   * @param {string[]} modules
   * @returns {Promise<object>}
   */
  async quoteSummary(_symbol, _modules) {
    throw new Error('quoteSummary() not implemented');
  }

  /**
   * @param {string} symbol
   * @param {string} [date]
   * @returns {Promise<object>}
   */
  async options(_symbol, _date) {
    throw new Error('options() not implemented');
  }
}
