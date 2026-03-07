import { inferInterval, resolveDateRange } from '../lib/dates.js';
import { classifyIntent, intentNeedsData } from './intents.js';
import { programForIntent } from './programs.js';

const FUNDAMENTAL_HINTS = [
  'fundamental',
  'valuation',
  'balance sheet',
  'income statement',
  'cash flow',
  'earnings',
  'multiple',
  'pe',
  'market cap',
  'margin',
];

const OPTIONS_HINTS = [
  'options',
  'iv',
  'implied volatility',
  'vol surface',
  'skew',
  'gex',
  'gamma exposure',
  'gamma flip',
  'gamma',
  'delta',
  'open interest',
  'max pain',
  'call wall',
  'put wall',
  '0dte',
  '0 dte',
  'zero dte',
  'put call',
  'dealer',
  'positioning',
  'sweep',
  'expiry',
  'expiries',
];

const RISK_HINTS = [
  'risk',
  'volatility',
  'beta',
  'drawdown',
  'correlation',
  'stress',
  'downside',
  'red',
  'bearish',
  'selloff',
];

const STOPWORDS = new Set([
  'A', 'I', 'AN', 'AM', 'AS', 'AT', 'BE', 'BY', 'DO', 'GO', 'IF', 'IN', 'IS', 'IT',
  'ME', 'MY', 'NO', 'OF', 'OK', 'ON', 'OR', 'SO', 'TO', 'UP', 'US', 'WE',
  'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'ANY', 'CAN', 'HAD',
  'HER', 'HIS', 'HIM', 'HOW', 'ITS', 'LET', 'MAY', 'NEW', 'NOW', 'OLD', 'OUR',
  'OUT', 'OWN', 'SAY', 'SHE', 'TOO', 'USE', 'WAY', 'WHO', 'DAY', 'DID',
  'GET', 'HAS', 'HAD', 'MAN', 'ONE', 'OUR', 'RUN', 'SET', 'TRY', 'WAS', 'WHY',
  'ALSO', 'BACK', 'BEEN', 'CALL', 'COME', 'EACH', 'FIND', 'FROM', 'GIVE',
  'GOOD', 'HAVE', 'HELP', 'HERE', 'HIGH', 'JUST', 'KNOW', 'LAST', 'LIKE', 'LONG',
  'LOOK', 'MAKE', 'MANY', 'MORE', 'MOST', 'MUCH', 'MUST', 'NAME', 'NEXT',
  'ONLY', 'OVER', 'PART', 'PULL', 'PUSH', 'PUTS', 'SAME', 'SHOW', 'SOME',
  'SUCH', 'TAKE', 'TELL', 'THAN', 'THAT', 'THEM', 'THEN', 'THEY', 'THIS',
  'TIME', 'VERY', 'WANT', 'WELL', 'WENT', 'WERE', 'WHAT', 'WHEN', 'WILL', 'WITH',
  'WORK', 'YEAR', 'YOUR', 'BEST', 'BOTH', 'CALL', 'DOES', 'DOWN', 'EVEN',
  'FOUR', 'KEEP', 'MOVE', 'NEED', 'RISK', 'SELL', 'SIDE', 'WHAT',
  'ABOUT', 'AFTER', 'COULD', 'EVERY', 'FIRST', 'GIVEN', 'GREAT', 'NEVER',
  'OTHER', 'PRICE', 'RIGHT', 'SHALL', 'SINCE', 'STILL', 'THEIR', 'THERE',
  'THESE', 'THING', 'THINK', 'THOSE', 'THREE', 'TODAY', 'UNDER', 'USING',
  'VALUE', 'WHICH', 'WHILE', 'WOULD', 'STOCK', 'TRADE', 'SETUP', 'POINT',
  'BROAD', 'EVENT', 'FRONT', 'QUOTE', 'STUDY', 'MONTH', 'DAILY',
  'COMPARE', 'ANALYZE', 'MARKET',
]);

export function extractTickerCandidates(text) {
  const matches = new Set();
  // Match $TICK or standalone 1-5 char uppercase sequences
  const regex = /\$[A-Z]{1,5}\b|\b[A-Z]{1,5}\b/g;
  for (const match of text.match(regex) || []) {
    const symbol = match.replace('$', '');
    if (symbol.length < 2) continue;
    if (STOPWORDS.has(symbol)) continue;
    matches.add(symbol);
  }
  return [...matches];
}

export function shouldFetchFundamentals(query, explicit = false) {
  if (explicit) return true;
  const text = query.toLowerCase();
  return FUNDAMENTAL_HINTS.some((hint) => text.includes(hint));
}

export function shouldFetchOptions(query, explicit = false) {
  if (explicit) return true;
  const text = query.toLowerCase();
  return OPTIONS_HINTS.some((hint) => text.includes(hint));
}

export function shouldUseBenchmark(query, symbols, benchmark) {
  if (benchmark) return true;
  const text = query.toLowerCase();
  return symbols.length > 1 || RISK_HINTS.some((hint) => text.includes(hint));
}

export function buildAnalysisPlan({
  query,
  symbols,
  benchmark,
  from,
  to,
  interval,
  config,
  includeFundamentals,
  includeOptions,
}) {
  const range = resolveDateRange({ from, to, lookbackDays: config.market.defaultLookbackDays });
  const resolvedInterval = inferInterval({
    from: range.from,
    to: range.to,
    requestedInterval: interval,
  });

  const intent = classifyIntent(query, symbols);
  const dataNeeds = intentNeedsData(intent.primary);

  const needsFundamentals = includeFundamentals || dataNeeds.fundamentals || shouldFetchFundamentals(query, false);
  const needsOptions = includeOptions || dataNeeds.options || shouldFetchOptions(query, false);
  const resolvedBenchmark =
    dataNeeds.benchmark && shouldUseBenchmark(query, symbols, benchmark)
      ? benchmark || config.market.defaultBenchmark
      : benchmark || null;

  const historySymbols = resolvedBenchmark
    ? [...new Set([...symbols, resolvedBenchmark])]
    : symbols;

  const program = programForIntent(intent.primary);

  return {
    range,
    interval: resolvedInterval,
    needsFundamentals,
    needsOptions,
    benchmark: resolvedBenchmark,
    historySymbols,
    intent,
    program,
  };
}

export function makeChildQuestions(query, symbols, benchmark, maxChildren = 3) {
  if (symbols.length <= 1) return [];
  const children = [];
  for (const symbol of symbols.slice(0, maxChildren)) {
    children.push({
      question: `Analyze ${symbol} for this objective: ${query}`,
      symbols: [symbol],
      benchmark,
    });
  }
  return children;
}

export function makeMarketMetricsCode() {
  return programForIntent('general').code;
}

export function renderDeterministicNarrative(node) {
  const lines = [];
  lines.push(`Analysis objective: ${node.question}`);
  lines.push(`Scope: ${node.symbols.join(', ')}`);
  lines.push(`Window: ${node.range.from} → ${node.range.to} (${node.interval})`);
  if (node.metrics?._sandboxError) {
    lines.push(`Sandbox warning: ${node.metrics._sandboxError}`);
  }

  const crossSection = node.metrics?.cross_section;
  if (crossSection?.symbol_count > 1) {
    lines.push('');
    lines.push('Comparison snapshot:');

    const leaderSpecs = [
      ['best_total_return', 'best total return'],
      ['best_risk_adjusted_return', 'best risk-adjusted return'],
      ['best_return_over_drawdown', 'best return over drawdown'],
      ['lowest_volatility', 'lowest volatility'],
      ['shallowest_drawdown', 'shallowest drawdown'],
      ['best_excess_return_vs_benchmark', 'best excess return vs benchmark'],
    ];

    for (const [key, label] of leaderSpecs) {
      const leader = crossSection.leaders?.[key];
      if (!leader) continue;
      lines.push(`- ${label}: ${leader.symbol} (${formatCrossSectionValue(key, leader.value)})`);
    }

    const rankingSpecs = [
      ['by_total_return', 'total return'],
      ['by_risk_adjusted_return', 'risk-adjusted return'],
      ['by_return_over_drawdown', 'return over drawdown'],
      ['by_lowest_volatility', 'lowest volatility'],
      ['by_shallowest_drawdown', 'shallowest drawdown'],
      ['by_excess_return_vs_benchmark', 'excess return vs benchmark'],
    ];

    for (const [key, label] of rankingSpecs) {
      const ranking = crossSection.rankings?.[key];
      if (!Array.isArray(ranking) || ranking.length <= 1) continue;
      lines.push(`- ${label}: ${formatRanking(ranking, key)}`);
    }

    for (const warning of crossSection.coverage_warnings || []) {
      lines.push(`- coverage warning: ${warning}`);
    }
  }

  for (const symbol of node.symbols) {
    const metrics = node.metrics?.symbols?.[symbol];
    if (!metrics) continue;
    const h = metrics.history || {};
    const f = metrics.fundamentals || {};
    const o = metrics.options || {};
    lines.push(``);
    lines.push(`${symbol}:`);
    if (h.last_close != null) lines.push(`- last close: ${formatNumber(h.last_close)}`);
    if (h.total_return != null) lines.push(`- total return: ${formatPct(h.total_return)}`);
    if (h.realized_vol_annualized != null) lines.push(`- realized vol (ann.): ${formatPct(h.realized_vol_annualized)}`);
    if (h.max_drawdown != null) lines.push(`- max drawdown: ${formatPct(h.max_drawdown)}`);
    if (f.market_cap != null) lines.push(`- market cap: ${formatLargeNumber(f.market_cap)}`);
    if (f.trailing_pe != null) lines.push(`- trailing P/E: ${formatNumber(f.trailing_pe)}`);
    if (o.avg_implied_volatility != null) lines.push(`- sampled option IV: ${formatPct(o.avg_implied_volatility)}`);
    if (o.avg_iv != null) lines.push(`- avg IV: ${formatPct(o.avg_iv)}`);
    if (o.atm_iv != null) lines.push(`- ATM IV: ${formatPct(o.atm_iv)}`);
    if (o.skew != null) lines.push(`- put-call skew: ${formatPct(o.skew)}`);
    if (o.active_expiration != null) lines.push(`- active expiration: ${o.active_expiration}`);
    if (o.put_call_oi_ratio != null) lines.push(`- put/call OI ratio: ${formatScalar(o.put_call_oi_ratio)}`);
    if (o.call_wall?.strike != null) lines.push(`- call wall: ${formatNumber(o.call_wall.strike)} (OI ${formatWholeNumber(o.call_wall.oi)})`);
    if (o.put_wall?.strike != null) lines.push(`- put wall: ${formatNumber(o.put_wall.strike)} (OI ${formatWholeNumber(o.put_wall.oi)})`);
    if (o.max_pain?.strike != null) {
      const suffix = o.max_pain.distance_from_spot_pct != null ? ` (${formatPct(o.max_pain.distance_from_spot_pct)} vs spot)` : '';
      lines.push(`- max pain: ${formatNumber(o.max_pain.strike)}${suffix}`);
    }
    if (o.net_gex_1pct_move != null) lines.push(`- net GEX (1% move): ${formatLargeNumber(o.net_gex_1pct_move)}`);
    if (o.gamma_flip?.level != null) {
      const suffix = o.gamma_flip.distance_from_spot_pct != null ? ` (${formatPct(o.gamma_flip.distance_from_spot_pct)} vs spot)` : '';
      lines.push(`- gamma flip: ${formatNumber(o.gamma_flip.level)}${suffix}`);
    }
    // 0DTE section
    if (o.zero_dte) {
      lines.push(`- 0DTE active: ${o.zero_dte.expiry} (${o.zero_dte.sampled_calls + o.zero_dte.sampled_puts} contracts)`);
      if (o.zero_dte.net_gex_1pct_move != null) lines.push(`  0DTE net GEX: ${formatLargeNumber(o.zero_dte.net_gex_1pct_move)}`);
      if (o.zero_dte.max_pain?.strike != null) lines.push(`  0DTE max pain: ${formatNumber(o.zero_dte.max_pain.strike)}`);
    } else if (o.expiry_sweep) {
      lines.push(`- 0DTE: none`);
    }
    // Expiry sweep highlights (top 2-3)
    if (Array.isArray(o.expiry_sweep) && o.expiry_sweep.length > 1) {
      const highlights = o.expiry_sweep.slice(0, 3);
      const parts = highlights.map((e) => `${e.expiry}(${e.dte_days ?? '?'}d, OI=${formatWholeNumber(e.total_open_interest || 0)})`);
      lines.push(`- expiry sweep (${o.expiry_sweep.length}): ${parts.join(', ')}`);
    }
    // Dealer profile aggregate
    if (o.dealer_profile) {
      const dp = o.dealer_profile;
      if (dp.aggregate_net_gex != null) lines.push(`- dealer net GEX (agg): ${formatLargeNumber(dp.aggregate_net_gex)}`);
      if (dp.aggregate_gamma_flip?.level != null) {
        const suffix = dp.aggregate_gamma_flip.distance_from_spot_pct != null ? ` (${formatPct(dp.aggregate_gamma_flip.distance_from_spot_pct)} vs spot)` : '';
        lines.push(`- dealer gamma flip (agg): ${formatNumber(dp.aggregate_gamma_flip.level)}${suffix}`);
      }
      if (dp.top_positive_gex_strikes?.length) {
        lines.push(`- top +GEX strike: ${formatNumber(dp.top_positive_gex_strikes[0].strike)} (${formatLargeNumber(dp.top_positive_gex_strikes[0].value)})`);
      }
      if (dp.top_negative_gex_strikes?.length) {
        lines.push(`- top -GEX strike: ${formatNumber(dp.top_negative_gex_strikes[0].strike)} (${formatLargeNumber(dp.top_negative_gex_strikes[0].value)})`);
      }
    }
    const tail = metrics.tail_risk;
    if (tail) {
      if (tail.var_95 != null) lines.push(`- VaR 95%: ${formatPct(tail.var_95)}`);
      if (tail.cvar_95 != null) lines.push(`- CVaR 95%: ${formatPct(tail.cvar_95)}`);
      if (tail.worst_day != null) lines.push(`- worst day: ${formatPct(tail.worst_day)}`);
    }
    const dd = metrics.drawdown;
    if (dd && dd.peak_date && dd.trough_date) {
      lines.push(`- max drawdown period: ${dd.peak_date} → ${dd.trough_date} (${formatPct(dd.max_drawdown)})`);
    }
  }

  const comparisons = node.metrics?.comparisons || {};
  for (const [name, comparison] of Object.entries(comparisons)) {
    lines.push(``);
    lines.push(`${humanizeComparisonName(name)}:`);
    if (comparison.beta != null) lines.push(`- beta: ${formatNumber(comparison.beta)}`);
    if (comparison.correlation != null) lines.push(`- correlation: ${formatNumber(comparison.correlation)}`);
    if (comparison.tracking_error != null) lines.push(`- tracking error: ${formatPct(comparison.tracking_error)}`);
    if (comparison.information_ratio != null) lines.push(`- information ratio: ${formatNumber(comparison.information_ratio)}`);
    if (comparison.upside_capture != null) lines.push(`- upside capture: ${formatPct(comparison.upside_capture)}`);
    if (comparison.downside_capture != null) lines.push(`- downside capture: ${formatPct(comparison.downside_capture)}`);
    if (comparison.paired_observations != null) lines.push(`- paired observations: ${comparison.paired_observations}`);
  }

  const pairwise = getPairwiseMetrics(node.metrics);
  if (Object.keys(pairwise).length) {
    lines.push('');
    lines.push('Pairwise:');
    for (const [name, pair] of Object.entries(pairwise)) {
      const parts = [];
      if (pair.correlation != null) parts.push(`corr=${formatNumber(pair.correlation)}`);
      if (pair.relative_return != null) parts.push(`rel.ret=${formatPct(pair.relative_return)}`);
      lines.push(`- ${humanizeComparisonName(name)}: ${parts.join(', ')}`);
    }
  }

  const valuationComps = node.metrics?.valuation_comps;
  if (valuationComps && Object.keys(valuationComps).length) {
    lines.push('');
    lines.push('Valuation comparison:');
    for (const [field, comp] of Object.entries(valuationComps)) {
      if (comp.cheapest && comp.richest && comp.cheapest !== comp.richest) {
        lines.push(`- ${field}: cheapest=${comp.cheapest}, richest=${comp.richest}`);
      }
    }
  }

  if (Array.isArray(node.children) && node.children.length) {
    lines.push('');
    lines.push('Child analyses:');
    for (const child of node.children) {
      lines.push(`- ${child.symbols.join(', ')}: ${child.summary}`);
    }
  }

  lines.push('');
  lines.push(node.reasoningNote || 'Used heuristic summarization because host sampling was unavailable.');
  return lines.join('\n');
}

function formatNumber(value) {
  return Number(value).toFixed(2);
}

function formatPct(value) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function formatScalar(value) {
  if (value == null) return 'n/a';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return formatNumber(number);
}

function formatLargeNumber(value) {
  const number = Number(value);
  const abs = Math.abs(number);
  if (abs >= 1_000_000_000_000) return `${(number / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(number / 1_000_000).toFixed(2)}M`;
  return formatNumber(number);
}

function formatWholeNumber(value) {
  return Math.round(Number(value)).toLocaleString('en-US');
}

function humanizeComparisonName(name) {
  return String(name).replace(/_vs_/g, ' vs ');
}

function getPairwiseMetrics(metrics) {
  if (metrics?.pairwise && Object.keys(metrics.pairwise).length) return metrics.pairwise;
  const matrix = metrics?.correlation_matrix || {};
  return Object.fromEntries(
    Object.entries(matrix).map(([name, correlation]) => [name, { correlation }]),
  );
}

function formatRanking(ranking, key) {
  return ranking
    .map((row) => `${row.symbol} (${formatCrossSectionValue(key, row.value)})`)
    .join(' > ');
}

function formatCrossSectionValue(key, value) {
  if (value == null) return 'n/a';
  if (key.includes('risk_adjusted') || key.includes('return_over_drawdown')) return formatScalar(value);
  if (key.includes('return') || key.includes('drawdown')) return formatPct(value);
  if (key.includes('volatility')) return formatPct(value);
  return formatScalar(value);
}

export function computeConfidence(node) {
  const factors = [];

  // 1. Data completeness — check for missing bars or failed fetches
  const symbols = node.symbols || [];
  const metricsSymbols = node.metrics?.symbols || {};
  if (symbols.length > 0) {
    const withData = symbols.filter((s) => {
      const m = metricsSymbols[s];
      return m && !m.error && (m.history?.bars > 0 || m.history?.last_close != null);
    });
    factors.push(withData.length / symbols.length);
  }

  // 2. Sample size — number of trading days
  const barCounts = symbols
    .map((s) => metricsSymbols[s]?.history?.bars || 0)
    .filter((n) => n > 0);
  if (barCounts.length) {
    const avgBars = barCounts.reduce((a, b) => a + b, 0) / barCounts.length;
    // 20 bars = low confidence (0.3), 60+ bars = high (1.0)
    factors.push(Math.min(1.0, Math.max(0.3, avgBars / 60)));
  }

  // 3. Sandbox success
  if (node.metrics?._sandboxError) {
    factors.push(0.3);
  } else if (node.metrics?.symbols && Object.keys(node.metrics.symbols).length > 0) {
    factors.push(1.0);
  }

  // 4. Coverage warnings
  const warnings = node.metrics?.cross_section?.coverage_warnings || [];
  if (warnings.length > 0) {
    factors.push(Math.max(0.4, 1.0 - warnings.length * 0.15));
  }

  if (factors.length === 0) return 0.5;
  const avg = factors.reduce((a, b) => a + b, 0) / factors.length;
  return Math.round(avg * 100) / 100;
}
