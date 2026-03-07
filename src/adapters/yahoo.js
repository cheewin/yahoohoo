import YahooFinance from 'yahoo-finance2';
import { TtlCache } from '../lib/cache.js';
import { stableStringify } from '../lib/json.js';
import { MarketDataProvider } from './base.js';

function key(parts) {
  return stableStringify(parts, 0);
}

const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeInclusivePeriod2(value) {
  if (!value || !ISO_DATE_ONLY_RE.test(value)) return value;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString();
}

function compactQuote(quote) {
  if (!quote) return null;
  return {
    symbol: quote.symbol,
    shortName: quote.shortName || quote.longName || null,
    currency: quote.currency || null,
    exchange: quote.fullExchangeName || quote.exchange || null,
    regularMarketPrice: quote.regularMarketPrice ?? null,
    regularMarketChange: quote.regularMarketChange ?? null,
    regularMarketChangePercent: quote.regularMarketChangePercent ?? null,
    regularMarketTime: quote.regularMarketTime ?? null,
    marketState: quote.marketState ?? null,
    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: quote.fiftyTwoWeekLow ?? null,
    marketCap: quote.marketCap ?? null,
    trailingPE: quote.trailingPE ?? null,
    forwardPE: quote.forwardPE ?? null,
    averageDailyVolume3Month: quote.averageDailyVolume3Month ?? null,
  };
}

function normalizeDateTime(value) {
  return value instanceof Date ? value.toISOString() : value ?? null;
}

function compactBar(bar) {
  return {
    date: bar.date instanceof Date ? bar.date.toISOString() : bar.date,
    open: bar.open ?? null,
    high: bar.high ?? null,
    low: bar.low ?? null,
    close: bar.close ?? null,
    volume: bar.volume ?? null,
    adjClose: bar.adjclose ?? bar.adjClose ?? null,
  };
}

function compactOptionContract(contract, fallbackExpiration) {
  return {
    contractSymbol: contract.contractSymbol ?? null,
    strike: contract.strike ?? null,
    currency: contract.currency ?? null,
    lastPrice: contract.lastPrice ?? null,
    change: contract.change ?? null,
    percentChange: contract.percentChange ?? null,
    volume: contract.volume ?? null,
    openInterest: contract.openInterest ?? null,
    bid: contract.bid ?? null,
    ask: contract.ask ?? null,
    contractSize: contract.contractSize ?? null,
    expiration: normalizeDateTime(contract.expiration ?? fallbackExpiration),
    lastTradeDate: normalizeDateTime(contract.lastTradeDate),
    impliedVolatility: contract.impliedVolatility ?? null,
    inTheMoney: contract.inTheMoney ?? null,
  };
}

function compactSummary(summary) {
  return {
    symbol: summary.symbol || summary.price?.symbol || null,
    price: summary.price || null,
    summaryDetail: summary.summaryDetail || null,
    financialData: summary.financialData || null,
    defaultKeyStatistics: summary.defaultKeyStatistics || null,
    calendarEvents: summary.calendarEvents || null,
    assetProfile: summary.assetProfile || null,
  };
}

function compactSearch(result, limit = 10) {
  const quotes = Array.isArray(result?.quotes) ? result.quotes : [];
  return quotes.slice(0, limit).map((item) => ({
    symbol: item.symbol,
    shortname: item.shortname || item.longname || item.name || null,
    exchange: item.exchange || item.exchDisp || null,
    quoteType: item.quoteType || null,
    score: item.score ?? null,
    isYahooFinance: item.isYahooFinance ?? true,
  }));
}

function compactScreenerQuote(q) {
  return {
    symbol: q.symbol,
    shortName: q.shortName || q.longName || null,
    regularMarketPrice: q.regularMarketPrice ?? null,
    regularMarketChangePercent: q.regularMarketChangePercent ?? null,
    marketCap: q.marketCap ?? null,
    regularMarketVolume: q.regularMarketVolume ?? null,
    trailingPE: q.trailingPE ?? null,
  };
}

function compactInsights(result) {
  const kt = result?.instrumentInfo?.keyTechnicals;
  const te = result?.instrumentInfo?.technicalEvents;
  const v = result?.instrumentInfo?.valuation;
  const formatOutlook = (o) =>
    o ? { direction: o.direction ?? null, score: o.score ?? null, description: o.stateDescription ?? null } : null;
  return {
    symbol: result?.symbol || null,
    technicals: kt ? { support: kt.support ?? null, resistance: kt.resistance ?? null, stopLoss: kt.stopLoss ?? null } : null,
    outlook: te
      ? { shortTerm: formatOutlook(te.shortTermOutlook), midTerm: formatOutlook(te.intermediateTermOutlook), longTerm: formatOutlook(te.longTermOutlook) }
      : null,
    valuation: v ? { description: v.description ?? null, discount: v.discount ?? null, relativeValue: v.relativeValue ?? null } : null,
    recommendation: result?.recommendation
      ? { rating: result.recommendation.rating ?? null, targetPrice: result.recommendation.targetPrice ?? null, provider: result.recommendation.provider ?? null }
      : null,
    sigDevs: Array.isArray(result?.sigDevs)
      ? result.sigDevs.slice(0, 5).map((d) => ({ headline: d.headline, date: d.date instanceof Date ? d.date.toISOString().slice(0, 10) : d.date }))
      : [],
    companySnapshot: result?.companySnapshot ? { sectorInfo: result.companySnapshot.sectorInfo ?? null, company: result.companySnapshot.company ?? null } : null,
  };
}

function compactOptions(result) {
  const chain = Array.isArray(result?.options) ? result.options[0] : null;
  const fallbackExpiration = chain?.expirationDate ?? null;
  const calls = Array.isArray(chain?.calls) ? chain.calls : Array.isArray(result?.calls) ? result.calls : [];
  const puts = Array.isArray(chain?.puts) ? chain.puts : Array.isArray(result?.puts) ? result.puts : [];
  return {
    underlyingSymbol: result?.underlyingSymbol || result?.symbol || null,
    activeExpirationDate: normalizeDateTime(fallbackExpiration),
    expirationDates: Array.isArray(result?.expirationDates)
      ? result.expirationDates.map((d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d))
      : [],
    strikes: Array.isArray(result?.strikes) ? result.strikes : [],
    calls: calls.map((contract) => compactOptionContract(contract, fallbackExpiration)),
    puts: puts.map((contract) => compactOptionContract(contract, fallbackExpiration)),
    quote: compactQuote(result?.quote),
    hasMiniOptions: chain?.hasMiniOptions ?? result?.hasMiniOptions ?? null,
  };
}

export class YahooMarketData extends MarketDataProvider {
  constructor({ cacheTtlMs, logger }) {
    super();
    this.logger = logger;
    this.cache = new TtlCache(cacheTtlMs);
    this.yf = new YahooFinance({
      suppressNotices: ['yahooSurvey'],
      validation: {
        logErrors: false,
      },
    });
  }

  async search(query, limit = 10) {
    return this.cache.memo(key(['search', query, limit]), async () => {
      this.logger.debug('Yahoo search', query);
      try {
        const result = await this.yf.search(query);
        return compactSearch(result, limit);
      } catch (error) {
        this.logger.warn(`Yahoo search failed for "${query}":`, error.message);
        return [];
      }
    });
  }

  async quote(symbols) {
    const uniqueSymbols = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
    return this.cache.memo(key(['quote', uniqueSymbols]), async () => {
      const rows = await Promise.allSettled(
        uniqueSymbols.map(async (symbol) => {
          const result = await this.yf.quote(symbol);
          return compactQuote(result);
        }),
      );
      const entries = [];
      for (let i = 0; i < uniqueSymbols.length; i++) {
        const outcome = rows[i];
        if (outcome.status === 'fulfilled' && outcome.value) {
          entries.push([outcome.value.symbol || uniqueSymbols[i], outcome.value]);
        } else {
          this.logger.warn(`Yahoo quote failed for ${uniqueSymbols[i]}:`, outcome.reason?.message);
          entries.push([uniqueSymbols[i], { symbol: uniqueSymbols[i], error: outcome.reason?.message || 'unknown error' }]);
        }
      }
      return Object.fromEntries(entries);
    });
  }

  async historical(symbol, { from, to, interval }) {
    const normalizedTo = normalizeInclusivePeriod2(to);
    return this.cache.memo(key(['historical', symbol, from, normalizedTo, interval]), async () => {
      try {
        const result = await this.yf.chart(symbol, {
          period1: from,
          period2: normalizedTo,
          interval,
        });
        return (Array.isArray(result?.quotes) ? result.quotes : []).map(compactBar);
      } catch (error) {
        this.logger.warn(`Yahoo chart failed for ${symbol}:`, error.message);
        return [];
      }
    });
  }

  async quoteSummary(symbol, modules) {
    return this.cache.memo(key(['summary', symbol, modules]), async () => {
      try {
        const result = await this.yf.quoteSummary(symbol, {
          modules,
        });
        return compactSummary(result);
      } catch (error) {
        this.logger.warn(`Yahoo quoteSummary failed for ${symbol}:`, error.message);
        return {};
      }
    });
  }

  async options(symbol, date) {
    return this.cache.memo(key(['options', symbol, date]), async () => {
      try {
        const result = await this.yf.options(symbol, date ? { date } : undefined);
        return compactOptions(result);
      } catch (error) {
        this.logger.warn(`Yahoo options failed for ${symbol}:`, error.message);
        return { underlyingSymbol: symbol, expirationDates: [], strikes: [], calls: [], puts: [], quote: null };
      }
    });
  }

  async screener(screenId, count = 10) {
    return this.cache.memo(key(['screener', screenId, count]), async () => {
      try {
        const result = await this.yf.screener(screenId, { count });
        const quotes = Array.isArray(result?.quotes) ? result.quotes : [];
        return { total: result?.total ?? quotes.length, quotes: quotes.map(compactScreenerQuote) };
      } catch (error) {
        this.logger.warn(`Yahoo screener failed for "${screenId}":`, error.message);
        return { total: 0, quotes: [] };
      }
    });
  }

  async trending(region = 'US', count = 10) {
    return this.cache.memo(key(['trending', region, count]), async () => {
      try {
        const result = await this.yf.trendingSymbols(region, { count });
        return Array.isArray(result?.quotes) ? result.quotes.map((q) => q.symbol) : [];
      } catch (error) {
        this.logger.warn(`Yahoo trending failed for "${region}":`, error.message);
        return [];
      }
    });
  }

  async insights(symbol) {
    return this.cache.memo(key(['insights', symbol]), async () => {
      try {
        const result = await this.yf.insights(symbol);
        return compactInsights(result);
      } catch (error) {
        this.logger.warn(`Yahoo insights failed for ${symbol}:`, error.message);
        return { symbol, error: error.message };
      }
    });
  }
}
