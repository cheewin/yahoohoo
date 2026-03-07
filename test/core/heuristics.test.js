import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTickerCandidates,
  shouldFetchFundamentals,
  shouldFetchOptions,
  shouldUseBenchmark,
  buildAnalysisPlan,
  makeChildQuestions,
  makeMarketMetricsCode,
  renderDeterministicNarrative,
  computeConfidence,
} from '../../src/core/heuristics.js';
import { loadConfig } from '../../src/lib/config.js';

describe('extractTickerCandidates', () => {
  it('extracts uppercase tickers', () => {
    const result = extractTickerCandidates('Look at AAPL and MSFT');
    assert.ok(result.includes('AAPL'));
    assert.ok(result.includes('MSFT'));
  });

  it('extracts $-prefixed tickers', () => {
    const result = extractTickerCandidates('$TSLA is moving');
    assert.ok(result.includes('TSLA'));
  });

  it('filters out common English words', () => {
    const result = extractTickerCandidates('USE THE STOCK FOR COMPARE ANALYZE');
    assert.equal(result.length, 0);
  });

  it('filters out single-char tokens', () => {
    const result = extractTickerCandidates('I A B');
    assert.ok(!result.includes('I'));
    assert.ok(!result.includes('A'));
  });

  it('handles mixed case text with tickers', () => {
    const result = extractTickerCandidates('Compare NVDA versus AMD for the best risk setup');
    assert.ok(result.includes('NVDA'));
    assert.ok(result.includes('AMD'));
    assert.ok(!result.includes('THE'));
    assert.ok(!result.includes('BEST'));
    assert.ok(!result.includes('RISK'));
    assert.ok(!result.includes('SETUP'));
  });

  it('returns empty for no tickers', () => {
    const result = extractTickerCandidates('what is the market doing today');
    assert.equal(result.length, 0);
  });

  it('deduplicates', () => {
    const result = extractTickerCandidates('AAPL is up, AAPL is great');
    assert.equal(result.filter((s) => s === 'AAPL').length, 1);
  });
});

describe('shouldFetchFundamentals', () => {
  it('returns true when explicit', () => {
    assert.equal(shouldFetchFundamentals('anything', true), true);
  });

  it('returns true for fundamental-related queries', () => {
    assert.equal(shouldFetchFundamentals('show me the valuation'), true);
    assert.equal(shouldFetchFundamentals('PE ratio analysis'), true);
  });

  it('returns false for unrelated queries', () => {
    assert.equal(shouldFetchFundamentals('price chart for AAPL'), false);
  });
});

describe('shouldFetchOptions', () => {
  it('returns true when explicit', () => {
    assert.equal(shouldFetchOptions('anything', true), true);
  });

  it('returns true for options-related queries', () => {
    assert.equal(shouldFetchOptions('implied volatility skew'), true);
    assert.equal(shouldFetchOptions('options chain analysis'), true);
    assert.equal(shouldFetchOptions('show me max pain and gex'), true);
  });

  it('returns false for unrelated queries', () => {
    assert.equal(shouldFetchOptions('daily returns for AAPL'), false);
  });
});

describe('shouldUseBenchmark', () => {
  it('returns true when benchmark is explicit', () => {
    assert.equal(shouldUseBenchmark('anything', ['AAPL'], 'QQQ'), true);
  });

  it('returns true for multi-symbol queries', () => {
    assert.equal(shouldUseBenchmark('compare', ['AAPL', 'MSFT']), true);
  });

  it('returns true for risk-related queries', () => {
    assert.equal(shouldUseBenchmark('what is the beta', ['AAPL']), true);
  });

  it('returns false for single symbol non-risk queries', () => {
    assert.equal(shouldUseBenchmark('show me AAPL price', ['AAPL']), false);
  });
});

describe('buildAnalysisPlan', () => {
  const config = loadConfig();

  it('builds a plan with resolved dates and interval', () => {
    const plan = buildAnalysisPlan({
      query: 'analyze AAPL',
      symbols: ['AAPL'],
      config,
    });
    assert.ok(plan.range.from);
    assert.ok(plan.range.to);
    assert.ok(plan.interval);
    assert.equal(plan.needsFundamentals, false);
    assert.equal(plan.needsOptions, false);
    assert.ok(plan.intent);
    assert.ok(plan.program);
    assert.ok(plan.program.code.length > 100);
  });

  it('includes benchmark when needed', () => {
    const plan = buildAnalysisPlan({
      query: 'compare risk',
      symbols: ['AAPL'],
      config,
    });
    assert.equal(plan.benchmark, 'SPY');
    assert.ok(plan.historySymbols.includes('SPY'));
  });

  it('does not include benchmark for simple single-symbol queries', () => {
    const plan = buildAnalysisPlan({
      query: 'show me AAPL price history',
      symbols: ['AAPL'],
      config,
    });
    assert.equal(plan.benchmark, null);
  });

  it('selects comparison program for multi-symbol compare queries', () => {
    const plan = buildAnalysisPlan({
      query: 'compare AAPL vs MSFT performance',
      symbols: ['AAPL', 'MSFT'],
      config,
    });
    assert.equal(plan.intent.primary, 'comparison');
    assert.equal(plan.program.name, 'comparison');
  });

  it('selects options program for IV queries', () => {
    const plan = buildAnalysisPlan({
      query: 'what is the implied volatility skew on AAPL',
      symbols: ['AAPL'],
      config,
      includeOptions: true,
    });
    assert.equal(plan.intent.primary, 'options');
    assert.equal(plan.program.name, 'options_analysis');
    assert.equal(plan.needsOptions, true);
  });

  it('selects fundamentals program for valuation queries', () => {
    const plan = buildAnalysisPlan({
      query: 'show me AAPL earnings and valuation',
      symbols: ['AAPL'],
      config,
    });
    assert.equal(plan.intent.primary, 'fundamentals');
    assert.equal(plan.program.name, 'fundamentals');
    assert.equal(plan.needsFundamentals, true);
  });
});

describe('makeChildQuestions', () => {
  it('returns empty for single symbol', () => {
    const children = makeChildQuestions('analyze AAPL', ['AAPL'], 'SPY');
    assert.equal(children.length, 0);
  });

  it('creates per-symbol children for multiple symbols', () => {
    const children = makeChildQuestions('compare AAPL vs MSFT', ['AAPL', 'MSFT'], 'SPY');
    assert.equal(children.length, 2);
    assert.deepEqual(children[0].symbols, ['AAPL']);
    assert.deepEqual(children[1].symbols, ['MSFT']);
  });

  it('respects max children limit', () => {
    const children = makeChildQuestions('compare', ['AAPL', 'MSFT', 'NVDA', 'AMD'], 'SPY', 2);
    assert.equal(children.length, 2);
  });
});

describe('makeMarketMetricsCode', () => {
  it('returns non-empty Python code', () => {
    const code = makeMarketMetricsCode();
    assert.ok(code.length > 100);
    assert.ok(code.includes('RESULT'));
    assert.ok(code.includes('summarize_history'));
  });
});

describe('renderDeterministicNarrative', () => {
  it('renders a narrative from a node', () => {
    const node = {
      question: 'analyze AAPL',
      symbols: ['AAPL'],
      range: { from: '2025-09-01', to: '2026-03-01' },
      interval: '1d',
      metrics: {
        symbols: {
          AAPL: {
            history: {
              last_close: 180,
              total_return: 0.05,
              realized_vol_annualized: 0.25,
              max_drawdown: -0.10,
            },
          },
        },
        comparisons: {},
      },
      children: [],
      reasoningNote: 'test note',
    };

    const narrative = renderDeterministicNarrative(node);
    assert.ok(narrative.includes('AAPL'));
    assert.ok(narrative.includes('180'));
    assert.ok(narrative.includes('5.00%'));
    assert.ok(narrative.includes('-10.00%'));
    assert.ok(narrative.includes('test note'));
  });

  it('handles nodes with children', () => {
    const node = {
      question: 'compare AAPL vs MSFT',
      symbols: ['AAPL', 'MSFT'],
      range: { from: '2025-09-01', to: '2026-03-01' },
      interval: '1d',
      metrics: { symbols: {}, comparisons: {} },
      children: [
        { symbols: ['AAPL'], summary: 'AAPL looks good' },
        { symbols: ['MSFT'], summary: 'MSFT is stable' },
      ],
      reasoningNote: null,
    };

    const narrative = renderDeterministicNarrative(node);
    assert.ok(narrative.includes('Child analyses'));
    assert.ok(narrative.includes('AAPL looks good'));
    assert.ok(narrative.includes('MSFT is stable'));
  });

  it('handles nodes with comparisons', () => {
    const node = {
      question: 'compare',
      symbols: ['AAPL'],
      range: { from: '2025-09-01', to: '2026-03-01' },
      interval: '1d',
      metrics: {
        symbols: {},
        comparisons: {
          AAPL_vs_SPY: { beta: 1.2, correlation: 0.85, paired_observations: 42 },
        },
      },
      children: [],
    };

    const narrative = renderDeterministicNarrative(node);
    assert.ok(narrative.includes('AAPL vs SPY'));
    assert.ok(narrative.includes('1.20'));
    assert.ok(narrative.includes('0.85'));
    assert.ok(narrative.includes('paired observations: 42'));
  });

  it('includes confidence annotation in narrative when present', () => {
    const node = {
      question: 'analyze AAPL',
      symbols: ['AAPL'],
      range: { from: '2025-09-01', to: '2026-03-01' },
      interval: '1d',
      metrics: {
        symbols: {
          AAPL: { history: { last_close: 180, total_return: 0.05, bars: 60 } },
        },
        comparisons: {},
      },
      children: [],
      reasoningNote: 'test',
    };
    const narrative = renderDeterministicNarrative(node);
    assert.ok(narrative.includes('AAPL'));
  });

  it('renders cross-section rankings for multi-symbol studies', () => {
    const node = {
      question: 'compare AAPL vs MSFT',
      symbols: ['AAPL', 'MSFT'],
      range: { from: '2025-09-01', to: '2026-03-01' },
      interval: '1d',
      metrics: {
        symbols: {
          AAPL: { history: { bars: 40, total_return: 0.18, realized_vol_annualized: 0.22, max_drawdown: -0.08 } },
          MSFT: { history: { bars: 40, total_return: 0.11, realized_vol_annualized: 0.17, max_drawdown: -0.04 } },
        },
        comparisons: {},
        cross_section: {
          symbol_count: 2,
          leaders: {
            best_total_return: { symbol: 'AAPL', value: 0.18 },
            best_risk_adjusted_return: { symbol: 'AAPL', value: 0.82 },
            lowest_volatility: { symbol: 'MSFT', value: 0.17 },
          },
          rankings: {
            by_total_return: [
              { symbol: 'AAPL', value: 0.18 },
              { symbol: 'MSFT', value: 0.11 },
            ],
            by_lowest_volatility: [
              { symbol: 'MSFT', value: 0.17 },
              { symbol: 'AAPL', value: 0.22 },
            ],
          },
          coverage_warnings: ['MSFT has limited history (4 bars).'],
        },
      },
      children: [],
      reasoningNote: 'Used heuristic summarization because host sampling was unavailable.',
    };

    const narrative = renderDeterministicNarrative(node);
    assert.ok(narrative.includes('Comparison snapshot'));
    assert.ok(narrative.includes('best total return: AAPL (18.00%)'));
    assert.ok(narrative.includes('total return: AAPL (18.00%) > MSFT (11.00%)'));
    assert.ok(narrative.includes('lowest volatility: MSFT (17.00%) > AAPL (22.00%)'));
    assert.ok(narrative.includes('coverage warning: MSFT has limited history (4 bars).'));
  });

  it('renders worst-day tail risk and correlation-matrix pairwise fallback', () => {
    const node = {
      question: 'tail risk deep dive',
      symbols: ['AAPL', 'MSFT'],
      range: { from: '2025-09-01', to: '2026-03-01' },
      interval: '1d',
      metrics: {
        symbols: {
          AAPL: {
            history: { last_close: 180, total_return: 0.05, realized_vol_annualized: 0.25 },
            tail_risk: { var_95: -0.02, cvar_95: -0.03, worst_day: -0.04 },
          },
          MSFT: {
            history: { last_close: 400, total_return: 0.04, realized_vol_annualized: 0.20 },
          },
        },
        comparisons: {},
        correlation_matrix: {
          AAPL_vs_MSFT: 0.75,
        },
      },
      children: [],
      reasoningNote: 'Used heuristic summarization because host sampling was unavailable.',
    };

    const narrative = renderDeterministicNarrative(node);
    assert.ok(narrative.includes('worst day: -4.00%'));
    assert.ok(narrative.includes('Pairwise:'));
    assert.ok(narrative.includes('AAPL vs MSFT: corr=0.75'));
  });

  it('renders options wall, max-pain, and gex lines', () => {
    const node = {
      question: 'show me max pain and gex on AAPL',
      symbols: ['AAPL'],
      range: { from: '2025-09-01', to: '2026-03-01' },
      interval: '1d',
      metrics: {
        symbols: {
          AAPL: {
            history: { last_close: 180, total_return: 0.05, realized_vol_annualized: 0.25 },
            options: {
              active_expiration: '2026-03-20',
              put_call_oi_ratio: 0.88,
              call_wall: { strike: 185, oi: 12000 },
              put_wall: { strike: 175, oi: 14000 },
              max_pain: { strike: 180, distance_from_spot_pct: 0 },
              net_gex_1pct_move: 12500000,
              gamma_flip: { level: 178.5, distance_from_spot_pct: -0.0083333333 },
            },
          },
        },
        comparisons: {},
      },
      children: [],
      reasoningNote: 'Used heuristic summarization because host sampling was unavailable.',
    };

    const narrative = renderDeterministicNarrative(node);
    assert.ok(narrative.includes('active expiration: 2026-03-20'));
    assert.ok(narrative.includes('put/call OI ratio: 0.88'));
    assert.ok(narrative.includes('call wall: 185.00 (OI 12,000)'));
    assert.ok(narrative.includes('put wall: 175.00 (OI 14,000)'));
    assert.ok(narrative.includes('max pain: 180.00'));
    assert.ok(narrative.includes('net GEX (1% move): 12.50M'));
    assert.ok(narrative.includes('gamma flip: 178.50'));
  });

  it('renders 0DTE, expiry sweep, and dealer profile in narrative', () => {
    const node = {
      question: 'show me 0dte dealer profile on SPY',
      symbols: ['SPY'],
      range: { from: '2025-09-01', to: '2026-03-07' },
      interval: '1d',
      metrics: {
        symbols: {
          SPY: {
            history: { last_close: 500, total_return: 0.02, realized_vol_annualized: 0.15 },
            options: {
              active_expiration: '2026-03-07',
              put_call_oi_ratio: 0.95,
              call_wall: { strike: 505, oi: 20000 },
              put_wall: { strike: 495, oi: 18000 },
              max_pain: { strike: 500, distance_from_spot_pct: 0 },
              net_gex_1pct_move: 25000000,
              gamma_flip: { level: 498, distance_from_spot_pct: -0.004 },
              zero_dte: {
                expiry: '2026-03-07',
                dte_days: 0,
                sampled_calls: 5,
                sampled_puts: 4,
                net_gex_1pct_move: 8000000,
                max_pain: { strike: 499, distance_from_spot_pct: -0.002 },
              },
              expiry_sweep: [
                { expiry: '2026-03-07', dte_days: 0, total_open_interest: 65000, sampled_calls: 5, sampled_puts: 4 },
                { expiry: '2026-03-14', dte_days: 7, total_open_interest: 34000, sampled_calls: 3, sampled_puts: 3 },
                { expiry: '2026-03-21', dte_days: 14, total_open_interest: 11000, sampled_calls: 2, sampled_puts: 1 },
              ],
              dealer_profile: {
                aggregate_net_gex: 30000000,
                aggregate_gamma_flip: { level: 497.5, distance_from_spot_pct: -0.005 },
                top_positive_gex_strikes: [{ strike: 505, value: 15000000 }],
                top_negative_gex_strikes: [{ strike: 490, value: -12000000 }],
              },
            },
          },
        },
        comparisons: {},
      },
      children: [],
      reasoningNote: 'test',
    };

    const narrative = renderDeterministicNarrative(node);
    // 0DTE section
    assert.ok(narrative.includes('0DTE active: 2026-03-07'));
    assert.ok(narrative.includes('0DTE net GEX'));
    assert.ok(narrative.includes('0DTE max pain'));
    // Expiry sweep highlights
    assert.ok(narrative.includes('expiry sweep (3)'));
    assert.ok(narrative.includes('2026-03-07'));
    assert.ok(narrative.includes('2026-03-14'));
    // Dealer profile
    assert.ok(narrative.includes('dealer net GEX (agg)'));
    assert.ok(narrative.includes('dealer gamma flip (agg)'));
    assert.ok(narrative.includes('top +GEX strike'));
    assert.ok(narrative.includes('top -GEX strike'));
  });

  it('renders 0DTE: none when sweep exists but no same-day', () => {
    const node = {
      question: 'sweep expiries on QQQ',
      symbols: ['QQQ'],
      range: { from: '2025-09-01', to: '2026-03-06' },
      interval: '1d',
      metrics: {
        symbols: {
          QQQ: {
            history: { last_close: 450 },
            options: {
              active_expiration: '2026-03-14',
              zero_dte: null,
              expiry_sweep: [
                { expiry: '2026-03-14', dte_days: 8, total_open_interest: 20000, sampled_calls: 3, sampled_puts: 2 },
              ],
            },
          },
        },
        comparisons: {},
      },
      children: [],
      reasoningNote: 'test',
    };

    const narrative = renderDeterministicNarrative(node);
    assert.ok(narrative.includes('0DTE: none'));
  });
});

describe('computeConfidence', () => {
  it('returns high confidence for complete data', () => {
    const node = {
      symbols: ['AAPL'],
      metrics: {
        symbols: {
          AAPL: { history: { bars: 120, last_close: 180, total_return: 0.05 } },
        },
      },
    };
    const c = computeConfidence(node);
    assert.ok(c >= 0.8, `expected high confidence, got ${c}`);
    assert.ok(c <= 1.0);
  });

  it('returns lower confidence when sandbox errored', () => {
    const node = {
      symbols: ['AAPL'],
      metrics: {
        symbols: {},
        _sandboxError: 'failed',
      },
    };
    const c = computeConfidence(node);
    assert.ok(c < 0.6, `expected low confidence, got ${c}`);
  });

  it('penalizes low bar counts', () => {
    const node = {
      symbols: ['AAPL'],
      metrics: {
        symbols: {
          AAPL: { history: { bars: 5, last_close: 100 } },
        },
      },
    };
    const c = computeConfidence(node);
    assert.ok(c < 0.8, `expected moderate confidence, got ${c}`);
  });

  it('penalizes coverage warnings', () => {
    const full = computeConfidence({
      symbols: ['AAPL'],
      metrics: {
        symbols: { AAPL: { history: { bars: 60, last_close: 100 } } },
      },
    });
    const warned = computeConfidence({
      symbols: ['AAPL'],
      metrics: {
        symbols: { AAPL: { history: { bars: 60, last_close: 100 } } },
        cross_section: { coverage_warnings: ['short history', 'gap detected'] },
      },
    });
    assert.ok(warned < full);
  });

  it('returns 0.5 for empty node', () => {
    assert.equal(computeConfidence({ symbols: [], metrics: {} }), 0.5);
  });
});
