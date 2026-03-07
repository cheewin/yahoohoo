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
    it('executes options analysis with IV metrics', () => {
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
                { strike: 185, impliedVolatility: 0.28, openInterest: 5000, volume: 200 },
                { strike: 190, impliedVolatility: 0.30, openInterest: 3000, volume: 100 },
              ],
              puts: [
                { strike: 175, impliedVolatility: 0.32, openInterest: 4000, volume: 150 },
                { strike: 170, impliedVolatility: 0.35, openInterest: 2000, volume: 80 },
              ],
              expirationDates: ['2026-02-20', '2026-03-20'],
            },
          },
        },
        settings: {},
      });

      assert.equal(result.ok, true);
      const opts = result.result.symbols.AAPL.options;
      assert.ok(opts);
      assert.equal(opts.sampled_calls, 2);
      assert.equal(opts.sampled_puts, 2);
      assert.ok(opts.avg_iv > 0);
      assert.ok(opts.total_open_interest > 0);
      assert.ok(opts.put_call_oi_ratio > 0);
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
