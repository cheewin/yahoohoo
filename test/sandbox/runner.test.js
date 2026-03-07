import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RUNNER = path.resolve('src/sandbox/runner.py');

function runSandbox(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yahoohoo-test-'));
  const payloadPath = path.join(dir, 'payload.json');
  fs.writeFileSync(payloadPath, JSON.stringify(payload));
  try {
    const stdout = execFileSync('python3', [RUNNER, payloadPath], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runSandboxExpectFail(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yahoohoo-test-'));
  const payloadPath = path.join(dir, 'payload.json');
  fs.writeFileSync(payloadPath, JSON.stringify(payload));
  try {
    const stdout = execFileSync('python3', [RUNNER, payloadPath], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return JSON.parse(stdout);
  } catch (error) {
    // The runner exits with code 1 and writes JSON to stdout
    if (error.stdout) {
      return JSON.parse(error.stdout);
    }
    throw error;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('sandbox runner', () => {
  describe('happy path', () => {
    it('executes simple computation', () => {
      const result = runSandbox({
        code: 'RESULT = {"answer": 42}',
        input_data: {},
        settings: {},
      });
      assert.equal(result.ok, true);
      assert.equal(result.result.answer, 42);
    });

    it('receives DATA from input_data', () => {
      const result = runSandbox({
        code: 'RESULT = {"value": DATA["x"] + DATA["y"]}',
        input_data: { x: 10, y: 20 },
        settings: {},
      });
      assert.equal(result.ok, true);
      assert.equal(result.result.value, 30);
    });

    it('can use math and statistics', () => {
      const result = runSandbox({
        code: 'from math import sqrt\nfrom statistics import mean\nRESULT = {"sqrt4": sqrt(4), "avg": mean([1,2,3])}',
        input_data: {},
        settings: {},
      });
      assert.equal(result.ok, true);
      assert.equal(result.result.sqrt4, 2.0);
      assert.equal(result.result.avg, 2);
    });

    it('can use safe builtins', () => {
      const result = runSandbox({
        code: 'RESULT = {"s": sum([1,2,3]), "l": len([1,2,3]), "mx": max([1,2,3])}',
        input_data: {},
        settings: {},
      });
      assert.equal(result.ok, true);
      assert.equal(result.result.s, 6);
      assert.equal(result.result.l, 3);
      assert.equal(result.result.mx, 3);
    });

    it('captures stdout', () => {
      const result = runSandbox({
        code: 'print("hello")\nRESULT = {}',
        input_data: {},
        settings: {},
      });
      assert.equal(result.ok, true);
      assert.ok(result.stdout.includes('hello'));
    });
  });

  describe('blocked operations', () => {
    it('blocks import of socket', () => {
      const result = runSandboxExpectFail({
        code: 'import socket\nRESULT = {}',
        input_data: {},
        settings: {},
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('not allowed'));
    });

    it('blocks import of subprocess', () => {
      const result = runSandboxExpectFail({
        code: 'import subprocess\nRESULT = {}',
        input_data: {},
        settings: {},
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('not allowed'));
    });

    it('blocks import of http', () => {
      const result = runSandboxExpectFail({
        code: 'import http.client\nRESULT = {}',
        input_data: {},
        settings: {},
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('not allowed'));
    });

    it('blocks import of os', () => {
      const result = runSandboxExpectFail({
        code: 'import os\nRESULT = {}',
        input_data: {},
        settings: {},
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('not allowed'));
    });

    it('blocks eval()', () => {
      const result = runSandboxExpectFail({
        code: 'eval("1+1")\nRESULT = {}',
        input_data: {},
        settings: {},
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('not allowed'));
    });

    it('blocks exec()', () => {
      const result = runSandboxExpectFail({
        code: 'exec("x=1")\nRESULT = {}',
        input_data: {},
        settings: {},
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('not allowed'));
    });

    it('blocks open()', () => {
      const result = runSandboxExpectFail({
        code: 'open("/etc/passwd")\nRESULT = {}',
        input_data: {},
        settings: {},
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('not allowed'));
    });

    it('blocks __import__', () => {
      const result = runSandboxExpectFail({
        code: '__import__("os")\nRESULT = {}',
        input_data: {},
        settings: {},
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('not allowed'));
    });

    it('blocks os attribute access', () => {
      const result = runSandboxExpectFail({
        code: 'os.system("ls")\nRESULT = {}',
        input_data: {},
        settings: {},
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('not allowed'));
    });
  });

  describe('syntax errors', () => {
    it('reports syntax errors clearly', () => {
      const result = runSandboxExpectFail({
        code: 'def foo(\nRESULT = {}',
        input_data: {},
        settings: {},
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('parse'));
    });
  });

  describe('comparison program', () => {
    it('executes comparison analysis with pairwise metrics', () => {
      const code = fs.readFileSync('src/sandbox/programs/comparison.py', 'utf-8');
      const fixture = JSON.parse(fs.readFileSync('test/fixtures/sandbox-metrics.json', 'utf-8'));
      fixture.code = code;
      const result = runSandbox(fixture);

      assert.equal(result.ok, true);
      assert.ok(result.result.symbols.AAPL);
      assert.ok(result.result.symbols.MSFT);
      assert.ok(result.result.pairwise.AAPL_vs_MSFT);
      assert.ok(result.result.cross_section);
      assert.equal(result.result.cross_section.symbol_count, 2);

      // Verify enriched metrics
      const aapl = result.result.symbols.AAPL.history;
      assert.ok(aapl.sharpe_ratio != null);
      assert.ok('sortino_ratio' in aapl);
      assert.ok(aapl.regime != null);

      // Verify benchmark comparison enrichment
      const comp = result.result.comparisons.AAPL_vs_SPY;
      assert.ok(comp);
      assert.ok(comp.tracking_error != null);
    });
  });

  describe('options_analysis program', () => {
    it('executes options analysis with IV, max pain, and gex metrics', () => {
      const code = fs.readFileSync('src/sandbox/programs/options_analysis.py', 'utf-8');
      const result = runSandbox({
        code,
        input_data: {
          symbols: ['AAPL'],
          benchmark: null,
          quotes: { AAPL: { symbol: 'AAPL', regularMarketPrice: 180 } },
          history: {
            AAPL: [
              { date: '2026-01-01T00:00:00Z', close: 170, volume: 1000000 },
              { date: '2026-01-02T00:00:00Z', close: 172, volume: 1100000 },
              { date: '2026-01-03T00:00:00Z', close: 175, volume: 900000 },
              { date: '2026-01-06T00:00:00Z', close: 178, volume: 1200000 },
              { date: '2026-01-07T00:00:00Z', close: 180, volume: 1300000 },
            ],
          },
          options: {
            AAPL: {
              calls: [
                { strike: 180, impliedVolatility: 0.29, openInterest: 8000, volume: 250, expiration: '2026-03-20T00:00:00Z', contractSize: 'REGULAR' },
                { strike: 185, impliedVolatility: 0.28, openInterest: 5000, volume: 200, expiration: '2026-03-20T00:00:00Z', contractSize: 'REGULAR' },
                { strike: 190, impliedVolatility: 0.30, openInterest: 3000, volume: 100, expiration: '2026-03-20T00:00:00Z', contractSize: 'REGULAR' },
              ],
              puts: [
                { strike: 175, impliedVolatility: 0.32, openInterest: 7000, volume: 150, expiration: '2026-03-20T00:00:00Z', contractSize: 'REGULAR' },
                { strike: 170, impliedVolatility: 0.35, openInterest: 6000, volume: 80, expiration: '2026-03-20T00:00:00Z', contractSize: 'REGULAR' },
              ],
              expirationDates: ['2026-03-20', '2026-04-17'],
            },
          },
        },
        settings: {},
      });

      assert.equal(result.ok, true);
      const opts = result.result.symbols.AAPL.options;
      assert.ok(opts);
      assert.equal(opts.sampled_calls, 3);
      assert.equal(opts.sampled_puts, 2);
      assert.ok(opts.avg_iv > 0);
      assert.ok(opts.total_open_interest > 0);
      assert.ok(opts.put_call_oi_ratio > 0);
      assert.equal(opts.call_wall.strike, 180);
      assert.equal(opts.put_wall.strike, 175);
      assert.ok(opts.max_pain.strike != null);
      assert.ok(opts.net_gex_1pct_move != null);
      assert.ok(opts.top_abs_gex_strikes.length > 0);
      // GEX by-strike data for dashboard
      assert.ok(opts._gex_by_strike != null);
      assert.ok(typeof opts._gex_by_strike === 'object');
      assert.ok(Object.keys(opts._gex_by_strike).length > 0);
      // Dashboard generated
      assert.ok(opts._dashboard != null);
      assert.ok(typeof opts._dashboard === 'string');
      assert.ok(opts._dashboard.includes('AAPL OPTIONS DASHBOARD'));
      assert.ok(opts._dashboard.includes('Key Levels'));
      assert.ok(opts._dashboard.includes('GEX Profile'));
      assert.ok(opts._dashboard.includes('Spot Price'));
      // Backward compat: no chains provided → multi-expiry fields are null
      assert.equal(opts.zero_dte, null);
      assert.equal(opts.expiry_sweep, null);
      assert.equal(opts.dealer_profile, null);
    });

    it('computes multi-expiry sweep with per-expiry metrics', () => {
      const code = fs.readFileSync('src/sandbox/programs/options_analysis.py', 'utf-8');
      const result = runSandbox({
        code,
        input_data: {
          symbols: ['SPY'],
          benchmark: null,
          quotes: { SPY: { symbol: 'SPY', regularMarketPrice: 500 } },
          history: {
            SPY: [
              { date: '2026-03-03T00:00:00Z', close: 495, volume: 2000000 },
              { date: '2026-03-04T00:00:00Z', close: 497, volume: 2100000 },
              { date: '2026-03-05T00:00:00Z', close: 498, volume: 2200000 },
              { date: '2026-03-06T00:00:00Z', close: 499, volume: 2000000 },
              { date: '2026-03-07T00:00:00Z', close: 500, volume: 2300000 },
            ],
          },
          options: {
            SPY: {
              calls: [
                { strike: 500, impliedVolatility: 0.18, openInterest: 20000, volume: 5000, expiration: '2026-03-07T00:00:00Z', contractSize: 'REGULAR' },
                { strike: 505, impliedVolatility: 0.19, openInterest: 15000, volume: 3000, expiration: '2026-03-07T00:00:00Z', contractSize: 'REGULAR' },
              ],
              puts: [
                { strike: 495, impliedVolatility: 0.22, openInterest: 18000, volume: 4000, expiration: '2026-03-07T00:00:00Z', contractSize: 'REGULAR' },
                { strike: 490, impliedVolatility: 0.25, openInterest: 12000, volume: 2000, expiration: '2026-03-07T00:00:00Z', contractSize: 'REGULAR' },
              ],
              expirationDates: ['2026-03-07', '2026-03-14', '2026-03-21'],
              chains: [
                {
                  expirationDate: '2026-03-07',
                  calls: [
                    { strike: 500, impliedVolatility: 0.18, openInterest: 20000, volume: 5000, expiration: '2026-03-07T00:00:00Z', contractSize: 'REGULAR' },
                    { strike: 505, impliedVolatility: 0.19, openInterest: 15000, volume: 3000, expiration: '2026-03-07T00:00:00Z', contractSize: 'REGULAR' },
                  ],
                  puts: [
                    { strike: 495, impliedVolatility: 0.22, openInterest: 18000, volume: 4000, expiration: '2026-03-07T00:00:00Z', contractSize: 'REGULAR' },
                    { strike: 490, impliedVolatility: 0.25, openInterest: 12000, volume: 2000, expiration: '2026-03-07T00:00:00Z', contractSize: 'REGULAR' },
                  ],
                },
                {
                  expirationDate: '2026-03-14',
                  calls: [
                    { strike: 500, impliedVolatility: 0.20, openInterest: 10000, volume: 2000, expiration: '2026-03-14T00:00:00Z', contractSize: 'REGULAR' },
                    { strike: 510, impliedVolatility: 0.21, openInterest: 8000, volume: 1500, expiration: '2026-03-14T00:00:00Z', contractSize: 'REGULAR' },
                  ],
                  puts: [
                    { strike: 495, impliedVolatility: 0.24, openInterest: 9000, volume: 1800, expiration: '2026-03-14T00:00:00Z', contractSize: 'REGULAR' },
                    { strike: 490, impliedVolatility: 0.26, openInterest: 7000, volume: 1200, expiration: '2026-03-14T00:00:00Z', contractSize: 'REGULAR' },
                  ],
                },
                {
                  expirationDate: '2026-03-21',
                  calls: [
                    { strike: 505, impliedVolatility: 0.22, openInterest: 6000, volume: 1000, expiration: '2026-03-21T00:00:00Z', contractSize: 'REGULAR' },
                  ],
                  puts: [
                    { strike: 495, impliedVolatility: 0.26, openInterest: 5000, volume: 800, expiration: '2026-03-21T00:00:00Z', contractSize: 'REGULAR' },
                  ],
                },
              ],
            },
          },
        },
        settings: {},
      });

      assert.equal(result.ok, true);
      const opts = result.result.symbols.SPY.options;

      // Expiry sweep
      assert.ok(Array.isArray(opts.expiry_sweep));
      assert.equal(opts.expiry_sweep.length, 3);
      // Sorted by DTE (nearest first)
      assert.equal(opts.expiry_sweep[0].expiry, '2026-03-07');
      assert.equal(opts.expiry_sweep[0].dte_days, 0); // same-day
      assert.equal(opts.expiry_sweep[1].expiry, '2026-03-14');
      assert.equal(opts.expiry_sweep[1].dte_days, 7);
      assert.equal(opts.expiry_sweep[2].expiry, '2026-03-21');
      assert.equal(opts.expiry_sweep[2].dte_days, 14);

      // Per-expiry metrics present
      for (const entry of opts.expiry_sweep) {
        assert.ok(entry.sampled_calls >= 1);
        assert.ok(entry.sampled_puts >= 1);
        assert.ok(entry.total_open_interest > 0);
        assert.ok(entry.put_call_oi_ratio != null);
        assert.ok(entry.call_wall != null);
        assert.ok(entry.put_wall != null);
        assert.ok(entry.max_pain != null);
        assert.ok(entry.net_gex_1pct_move != null);
        assert.ok(entry.call_gex_1pct_move != null);
        assert.ok(entry.put_gex_1pct_move != null);
      }

      // 0DTE detection (last history bar is 2026-03-07, first chain is 2026-03-07)
      assert.ok(opts.zero_dte != null);
      assert.equal(opts.zero_dte.expiry, '2026-03-07');
      assert.equal(opts.zero_dte.dte_days, 0);
      assert.ok(opts.zero_dte.net_gex_1pct_move != null);

      // Dealer profile
      assert.ok(opts.dealer_profile != null);
      assert.equal(opts.dealer_profile.expiries_included, 3);
      assert.ok(opts.dealer_profile.aggregate_net_gex != null);
      assert.ok(opts.dealer_profile.aggregate_call_gex != null);
      assert.ok(opts.dealer_profile.aggregate_put_gex != null);
      assert.ok(opts.dealer_profile.label.includes('proxy'));
      assert.ok(Array.isArray(opts.dealer_profile.max_pain_ladder));
      assert.equal(opts.dealer_profile.max_pain_ladder.length, 3);
      assert.ok(Array.isArray(opts.dealer_profile.by_expiry));
      assert.equal(opts.dealer_profile.by_expiry.length, 3);
      // Dealer profile has aggregate by_strike
      assert.ok(opts.dealer_profile._gex_by_strike != null);

      // Multi-expiry dashboard
      assert.ok(opts._dashboard != null);
      assert.ok(typeof opts._dashboard === 'string');
      assert.ok(opts._dashboard.includes('SPY OPTIONS DASHBOARD'));
      assert.ok(opts._dashboard.includes('Key Levels'));
      assert.ok(opts._dashboard.includes('GEX Profile'));
      assert.ok(opts._dashboard.includes('Expiry Sweep'));
      assert.ok(opts._dashboard.includes('Dealer Profile'));
      assert.ok(opts._dashboard.includes('IV Term Structure'));
      assert.ok(opts._dashboard.includes('0DTE'));
    });

    it('sets zero_dte to null when no same-day expiry exists', () => {
      const code = fs.readFileSync('src/sandbox/programs/options_analysis.py', 'utf-8');
      const result = runSandbox({
        code,
        input_data: {
          symbols: ['QQQ'],
          benchmark: null,
          quotes: { QQQ: { symbol: 'QQQ', regularMarketPrice: 450 } },
          history: {
            QQQ: [
              { date: '2026-03-05T00:00:00Z', close: 448, volume: 1500000 },
              { date: '2026-03-06T00:00:00Z', close: 450, volume: 1600000 },
            ],
          },
          options: {
            QQQ: {
              calls: [
                { strike: 450, impliedVolatility: 0.22, openInterest: 10000, volume: 2000, expiration: '2026-03-14T00:00:00Z', contractSize: 'REGULAR' },
              ],
              puts: [
                { strike: 445, impliedVolatility: 0.25, openInterest: 8000, volume: 1500, expiration: '2026-03-14T00:00:00Z', contractSize: 'REGULAR' },
              ],
              expirationDates: ['2026-03-14', '2026-03-21'],
              chains: [
                {
                  expirationDate: '2026-03-14',
                  calls: [{ strike: 450, impliedVolatility: 0.22, openInterest: 10000, volume: 2000, expiration: '2026-03-14T00:00:00Z', contractSize: 'REGULAR' }],
                  puts: [{ strike: 445, impliedVolatility: 0.25, openInterest: 8000, volume: 1500, expiration: '2026-03-14T00:00:00Z', contractSize: 'REGULAR' }],
                },
                {
                  expirationDate: '2026-03-21',
                  calls: [{ strike: 455, impliedVolatility: 0.23, openInterest: 5000, volume: 1000, expiration: '2026-03-21T00:00:00Z', contractSize: 'REGULAR' }],
                  puts: [{ strike: 440, impliedVolatility: 0.27, openInterest: 4000, volume: 800, expiration: '2026-03-21T00:00:00Z', contractSize: 'REGULAR' }],
                },
              ],
            },
          },
        },
        settings: {},
      });

      assert.equal(result.ok, true);
      const opts = result.result.symbols.QQQ.options;
      assert.equal(opts.zero_dte, null); // No same-day expiry
      assert.ok(Array.isArray(opts.expiry_sweep));
      assert.equal(opts.expiry_sweep.length, 2);
      assert.ok(opts.dealer_profile != null);
    });
  });

  describe('fundamentals program', () => {
    it('executes fundamentals analysis with valuation comps', () => {
      const code = fs.readFileSync('src/sandbox/programs/fundamentals.py', 'utf-8');
      const result = runSandbox({
        code,
        input_data: {
          symbols: ['AAPL', 'MSFT'],
          benchmark: null,
          quotes: {},
          history: {
            AAPL: [
              { date: '2026-01-01T00:00:00Z', close: 170, volume: 1000000 },
              { date: '2026-01-07T00:00:00Z', close: 180, volume: 1300000 },
            ],
            MSFT: [
              { date: '2026-01-01T00:00:00Z', close: 390, volume: 500000 },
              { date: '2026-01-07T00:00:00Z', close: 400, volume: 620000 },
            ],
          },
          summaries: {
            AAPL: {
              summaryDetail: { marketCap: 2800000000000, trailingPE: 30, forwardPE: 28 },
              financialData: { profitMargins: 0.25, returnOnEquity: 1.5, totalRevenue: 380000000000 },
              defaultKeyStatistics: { priceToBook: 45, pegRatio: 2.5 },
            },
            MSFT: {
              summaryDetail: { marketCap: 3100000000000, trailingPE: 35, forwardPE: 32 },
              financialData: { profitMargins: 0.35, returnOnEquity: 0.4, totalRevenue: 210000000000 },
              defaultKeyStatistics: { priceToBook: 12, pegRatio: 1.8 },
            },
          },
        },
        settings: {},
      });

      assert.equal(result.ok, true);
      assert.ok(result.result.symbols.AAPL.fundamentals.valuation);
      assert.ok(result.result.symbols.MSFT.fundamentals.profitability);
      assert.ok(result.result.valuation_comps);
      assert.ok(result.result.valuation_comps.trailing_pe);
    });
  });

  describe('risk_analysis program', () => {
    it('executes risk analysis with tail risk and stress detection', () => {
      const code = fs.readFileSync('src/sandbox/programs/risk_analysis.py', 'utf-8');
      const fixture = JSON.parse(fs.readFileSync('test/fixtures/sandbox-metrics.json', 'utf-8'));
      fixture.code = code;
      const result = runSandbox(fixture);

      assert.equal(result.ok, true);
      assert.ok(result.result.symbols.AAPL);
      assert.ok(result.result.symbols.AAPL.drawdown);
      assert.ok(result.result.symbols.AAPL.rolling_vol);
      assert.ok(result.result.comparisons.AAPL_vs_SPY);
      assert.ok(result.result.cross_section);
      assert.equal(result.result.cross_section.symbol_count, 2);
      assert.ok(result.result.pairwise.AAPL_vs_MSFT);

      // Correlation matrix for multi-symbol
      assert.ok(result.result.correlation_matrix);
      assert.ok(result.result.correlation_matrix.AAPL_vs_MSFT != null);
    });
  });

  describe('market_metrics program', () => {
    it('executes the standard market metrics program', () => {
      const code = fs.readFileSync('src/sandbox/programs/market_metrics.py', 'utf-8');
      const fixture = JSON.parse(fs.readFileSync('test/fixtures/sandbox-metrics.json', 'utf-8'));
      fixture.code = code;
      const result = runSandbox(fixture);

      assert.equal(result.ok, true);
      assert.ok(result.result.symbols.AAPL);
      assert.ok(result.result.symbols.MSFT);
      assert.equal(result.result.benchmark, 'SPY');
      assert.ok(result.result.comparisons.AAPL_vs_SPY);
      assert.ok(result.result.comparisons.MSFT_vs_SPY);
      assert.deepEqual(Object.keys(result.result.symbols), ['AAPL', 'MSFT']);
      assert.equal(result.result.cross_section.symbol_count, 2);
      assert.equal(result.result.cross_section.leaders.best_total_return.symbol, 'AAPL');
      assert.equal(result.result.cross_section.rankings.by_total_return[0].symbol, 'AAPL');
      assert.equal(result.result.cross_section.rankings.by_excess_return_vs_benchmark[0].symbol, 'AAPL');

      // Validate computed metrics
      const aapl = result.result.symbols.AAPL.history;
      assert.equal(aapl.bars, 5);
      assert.ok(aapl.total_return > 0);
      assert.ok(aapl.realized_vol_annualized > 0);
      assert.ok(aapl.max_drawdown < 0);

      // Validate comparisons
      const aaplVsSpy = result.result.comparisons.AAPL_vs_SPY;
      assert.ok(aaplVsSpy.correlation > 0);
      assert.ok(aaplVsSpy.beta > 0);
      assert.equal(aaplVsSpy.paired_observations, 4);
    });

    it('handles empty history gracefully', () => {
      const code = fs.readFileSync('src/sandbox/programs/market_metrics.py', 'utf-8');
      const result = runSandbox({
        code,
        input_data: {
          symbols: ['AAPL'],
          benchmark: null,
          quotes: {},
          history: { AAPL: [] },
          summaries: {},
          options: {},
        },
        settings: {},
      });

      assert.equal(result.ok, true);
      assert.equal(result.result.symbols.AAPL.history.bars, 0);
    });

    it('handles single-bar history', () => {
      const code = fs.readFileSync('src/sandbox/programs/market_metrics.py', 'utf-8');
      const result = runSandbox({
        code,
        input_data: {
          symbols: ['AAPL'],
          benchmark: null,
          quotes: {},
          history: {
            AAPL: [{ date: '2026-01-01T00:00:00Z', close: 100, volume: 500000 }],
          },
          summaries: {},
          options: {},
        },
        settings: {},
      });

      assert.equal(result.ok, true);
      assert.equal(result.result.symbols.AAPL.history.bars, 1);
      assert.equal(result.result.symbols.AAPL.history.total_return, null);
    });
  });
});
