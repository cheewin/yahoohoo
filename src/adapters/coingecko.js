import { TtlCache } from '../lib/cache.js';
import { stableStringify } from '../lib/json.js';

function key(parts) {
  return stableStringify(parts, 0);
}

const BASE = 'https://api.coingecko.com/api/v3';

/**
 * CoinGecko data provider for crypto-specific market data.
 *
 * This is NOT a MarketDataProvider subclass — it's a supplementary source
 * for crypto-specific endpoints that Yahoo Finance doesn't cover:
 * trending coins, global market stats, top coins by market cap, etc.
 *
 * No API key required for the public endpoints used here.
 * Rate limit: ~10-30 calls/min without key, 30/min with demo key.
 */
export class CoinGeckoData {
  constructor({ cacheTtlMs, logger, apiKey }) {
    this.logger = logger;
    this.cache = new TtlCache(cacheTtlMs);
    this.apiKey = apiKey || process.env.COINGECKO_API_KEY || null;
  }

  async _fetch(path, params = {}) {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }

    const headers = { Accept: 'application/json' };
    if (this.apiKey) headers['x-cg-demo-api-key'] = this.apiKey;

    this.logger.debug('CoinGecko fetch', url.pathname);
    const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(15_000) });

    if (res.status === 429) {
      this.logger.warn('CoinGecko rate limited');
      return { _rateLimit: true };
    }
    if (!res.ok) {
      this.logger.warn(`CoinGecko ${path} failed: ${res.status}`);
      return null;
    }
    return res.json();
  }

  /**
   * Get prices for multiple coins in one call.
   * @param {string[]} ids - CoinGecko coin IDs (e.g. ['bitcoin', 'ethereum'])
   * @param {string} vsCurrency - Target currency (default: 'usd')
   */
  async prices(ids, vsCurrency = 'usd') {
    return this.cache.memo(key(['cg-prices', ids, vsCurrency]), async () => {
      const data = await this._fetch('/simple/price', {
        ids: ids.join(','),
        vs_currencies: vsCurrency,
        include_market_cap: true,
        include_24hr_vol: true,
        include_24hr_change: true,
        include_last_updated_at: true,
      });
      if (!data || data._rateLimit) return {};
      return data;
    });
  }

  /**
   * Top coins by market cap with rich data.
   * @param {number} perPage - Number of results (max 250)
   * @param {string} vsCurrency
   */
  async markets(perPage = 20, vsCurrency = 'usd') {
    return this.cache.memo(key(['cg-markets', perPage, vsCurrency]), async () => {
      const data = await this._fetch('/coins/markets', {
        vs_currency: vsCurrency,
        order: 'market_cap_desc',
        per_page: perPage,
        page: 1,
        sparkline: false,
        price_change_percentage: '1h,24h,7d,30d',
      });
      if (!data || data._rateLimit) return [];
      return data.map(compactMarketCoin);
    });
  }

  /**
   * Trending coins (what people are searching for).
   */
  async trending() {
    return this.cache.memo(key(['cg-trending']), async () => {
      const data = await this._fetch('/search/trending');
      if (!data || data._rateLimit) return { coins: [], nfts: [], categories: [] };
      return {
        coins: (data.coins || []).map((c) => {
          const item = c.item || c;
          return {
            id: item.id,
            name: item.name,
            symbol: item.symbol?.toUpperCase(),
            rank: item.market_cap_rank ?? item.score ?? null,
            thumb: item.thumb ?? null,
            price_btc: item.price_btc ?? null,
            data: item.data ? {
              price: item.data.price ?? null,
              price_change_24h: item.data.price_change_percentage_24h?.usd ?? null,
              market_cap: item.data.market_cap ?? null,
              volume: item.data.total_volume ?? null,
            } : null,
          };
        }),
        categories: (data.categories || []).slice(0, 5).map((cat) => ({
          id: cat.id,
          name: cat.name,
          market_cap_change_24h: cat.data?.market_cap_change_percentage_24h?.usd ?? null,
        })),
      };
    });
  }

  /**
   * Global crypto market overview.
   */
  async global() {
    return this.cache.memo(key(['cg-global']), async () => {
      const data = await this._fetch('/global');
      if (!data?.data || data._rateLimit) return null;
      const d = data.data;
      return {
        active_cryptocurrencies: d.active_cryptocurrencies,
        markets: d.markets,
        total_market_cap_usd: d.total_market_cap?.usd ?? null,
        total_volume_24h_usd: d.total_volume?.usd ?? null,
        market_cap_change_24h_pct: d.market_cap_change_percentage_24h_usd ?? null,
        btc_dominance: d.market_cap_percentage?.btc ?? null,
        eth_dominance: d.market_cap_percentage?.eth ?? null,
        top_dominance: Object.entries(d.market_cap_percentage || {})
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([symbol, pct]) => ({ symbol: symbol.toUpperCase(), dominance_pct: +pct.toFixed(2) })),
        updated_at: d.updated_at ?? null,
      };
    });
  }

  /**
   * Search coins by query.
   * @param {string} query
   */
  async search(query) {
    return this.cache.memo(key(['cg-search', query]), async () => {
      const data = await this._fetch('/search', { query });
      if (!data || data._rateLimit) return [];
      return (data.coins || []).slice(0, 15).map((c) => ({
        id: c.id,
        name: c.name,
        symbol: c.symbol?.toUpperCase(),
        rank: c.market_cap_rank ?? null,
        thumb: c.thumb ?? null,
      }));
    });
  }

  /**
   * OHLC candle data for a coin.
   * @param {string} id - CoinGecko coin ID
   * @param {number} days - 1, 7, 14, 30, 90, 180, 365
   * @param {string} vsCurrency
   */
  async ohlc(id, days = 30, vsCurrency = 'usd') {
    return this.cache.memo(key(['cg-ohlc', id, days, vsCurrency]), async () => {
      const data = await this._fetch(`/coins/${id}/ohlc`, {
        vs_currency: vsCurrency,
        days,
      });
      if (!data || data._rateLimit || !Array.isArray(data)) return [];
      return data.map(([timestamp, open, high, low, close]) => ({
        date: new Date(timestamp).toISOString(),
        open,
        high,
        low,
        close,
        volume: null, // OHLC endpoint doesn't include volume
      }));
    });
  }

  /**
   * Detailed coin info.
   * @param {string} id - CoinGecko coin ID
   */
  async coinInfo(id) {
    return this.cache.memo(key(['cg-coin', id]), async () => {
      const data = await this._fetch(`/coins/${id}`, {
        localization: false,
        tickers: false,
        market_data: true,
        community_data: false,
        developer_data: false,
        sparkline: false,
      });
      if (!data || data._rateLimit) return null;
      const md = data.market_data || {};
      return {
        id: data.id,
        symbol: data.symbol?.toUpperCase(),
        name: data.name,
        description: data.description?.en?.slice(0, 300) || null,
        genesis_date: data.genesis_date || null,
        categories: data.categories || [],
        links: {
          homepage: data.links?.homepage?.[0] || null,
          blockchain_site: data.links?.blockchain_site?.filter(Boolean)?.[0] || null,
          subreddit: data.links?.subreddit_url || null,
        },
        market_data: {
          price_usd: md.current_price?.usd ?? null,
          market_cap_usd: md.market_cap?.usd ?? null,
          market_cap_rank: md.market_cap_rank ?? data.market_cap_rank ?? null,
          volume_24h_usd: md.total_volume?.usd ?? null,
          high_24h: md.high_24h?.usd ?? null,
          low_24h: md.low_24h?.usd ?? null,
          ath: md.ath?.usd ?? null,
          ath_date: md.ath_date?.usd ?? null,
          ath_change_pct: md.ath_change_percentage?.usd ?? null,
          atl: md.atl?.usd ?? null,
          atl_date: md.atl_date?.usd ?? null,
          circulating_supply: md.circulating_supply ?? null,
          total_supply: md.total_supply ?? null,
          max_supply: md.max_supply ?? null,
          price_change_24h_pct: md.price_change_percentage_24h ?? null,
          price_change_7d_pct: md.price_change_percentage_7d ?? null,
          price_change_30d_pct: md.price_change_percentage_30d ?? null,
          price_change_1y_pct: md.price_change_percentage_1y ?? null,
        },
      };
    });
  }
}

function compactMarketCoin(c) {
  return {
    id: c.id,
    symbol: c.symbol?.toUpperCase(),
    name: c.name,
    rank: c.market_cap_rank ?? null,
    price: c.current_price ?? null,
    market_cap: c.market_cap ?? null,
    volume_24h: c.total_volume ?? null,
    change_1h_pct: c.price_change_percentage_1h_in_currency ?? null,
    change_24h_pct: c.price_change_percentage_24h_in_currency ?? null,
    change_7d_pct: c.price_change_percentage_7d_in_currency ?? null,
    change_30d_pct: c.price_change_percentage_30d_in_currency ?? null,
    ath: c.ath ?? null,
    ath_change_pct: c.ath_change_percentage ?? null,
    circulating_supply: c.circulating_supply ?? null,
    total_supply: c.total_supply ?? null,
  };
}
