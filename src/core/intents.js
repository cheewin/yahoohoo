const INTENT_PATTERNS = {
  comparison: {
    hints: ['compare', 'versus', ' vs ', 'relative', 'outperform', 'underperform', 'which is better', 'rank', 'head to head'],
    minSymbols: 2,
  },
  options: {
    hints: ['options', 'iv ', 'implied volatility', 'vol surface', 'skew', 'gamma', 'delta', 'vega', 'theta', 'open interest', 'put call', 'put/call', 'straddle', 'strangle', 'iron condor', 'term structure', 'vol smile'],
  },
  fundamentals: {
    hints: ['fundamental', 'valuation', 'balance sheet', 'income statement', 'cash flow', 'earnings', 'revenue', 'multiple', 'pe ratio', 'p/e', 'market cap', 'margin', 'profit', 'roe', 'roa', 'debt', 'dividend', 'book value', 'eps', 'free cash flow', 'fcf'],
  },
  risk: {
    hints: ['risk', 'volatility', 'beta', 'drawdown', 'correlation', 'stress', 'downside', 'var ', 'value at risk', 'tail risk', 'max loss', 'sharpe', 'sortino', 'risk-adjusted'],
  },
  macro: {
    hints: ['macro', 'sector', 'rotation', 'fed', 'fomc', 'cpi', 'inflation', 'yield curve', 'treasury', 'rates', 'economy', 'gdp', 'recession', 'regime'],
  },
  portfolio: {
    hints: ['portfolio', 'allocation', 'weight', 'rebalance', 'diversif', 'concentration', 'exposure', 'holdings', 'overlap'],
    minSymbols: 2,
  },
};

export const INTENTS = Object.keys(INTENT_PATTERNS);

export function classifyIntent(query, symbols = []) {
  const text = query.toLowerCase();
  const scores = {};

  for (const [intent, spec] of Object.entries(INTENT_PATTERNS)) {
    let score = 0;
    for (const hint of spec.hints) {
      if (text.includes(hint)) score += 1;
    }
    if (spec.minSymbols && symbols.length >= spec.minSymbols) {
      score += 0.5;
    }
    scores[intent] = score;
  }

  const sorted = Object.entries(scores)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);

  if (!sorted.length) {
    if (symbols.length >= 2) return { primary: 'comparison', secondary: [] };
    return { primary: 'general', secondary: [] };
  }

  const primary = sorted[0][0];
  const secondary = sorted.slice(1).filter(([, s]) => s > 0).map(([k]) => k);
  return { primary, secondary };
}

export function intentNeedsData(intent) {
  return {
    history: true,
    fundamentals: intent === 'fundamentals' || intent === 'portfolio',
    options: intent === 'options',
    benchmark: intent !== 'fundamentals' && intent !== 'options',
  };
}
