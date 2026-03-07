import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIntent, intentNeedsData, INTENTS } from '../../src/core/intents.js';

describe('classifyIntent', () => {
  it('detects comparison intent for multi-symbol queries', () => {
    const result = classifyIntent('Compare AAPL vs MSFT performance', ['AAPL', 'MSFT']);
    assert.equal(result.primary, 'comparison');
  });

  it('detects options intent', () => {
    const result = classifyIntent('What is the implied volatility skew on AAPL?', ['AAPL']);
    assert.equal(result.primary, 'options');
  });

  it('detects fundamentals intent', () => {
    const result = classifyIntent('Show me AAPL valuation and earnings', ['AAPL']);
    assert.equal(result.primary, 'fundamentals');
  });

  it('detects risk intent', () => {
    const result = classifyIntent('What is the drawdown and beta risk of TSLA?', ['TSLA']);
    assert.equal(result.primary, 'risk');
  });

  it('detects macro intent', () => {
    const result = classifyIntent('How does sector rotation look after the FOMC meeting?', []);
    assert.equal(result.primary, 'macro');
  });

  it('detects portfolio intent', () => {
    const result = classifyIntent('Analyze my portfolio allocation and diversification', ['AAPL', 'MSFT', 'GOOG']);
    assert.equal(result.primary, 'portfolio');
  });

  it('falls back to general for unclassifiable single-symbol', () => {
    const result = classifyIntent('Tell me about AAPL', ['AAPL']);
    assert.equal(result.primary, 'general');
  });

  it('falls back to comparison for unclassifiable multi-symbol', () => {
    const result = classifyIntent('AAPL MSFT', ['AAPL', 'MSFT']);
    assert.equal(result.primary, 'comparison');
  });

  it('provides secondary intents', () => {
    const result = classifyIntent('Compare risk and volatility of AAPL vs MSFT options', ['AAPL', 'MSFT']);
    assert.ok(result.secondary.length > 0);
  });
});

describe('intentNeedsData', () => {
  it('options intent needs options data', () => {
    const needs = intentNeedsData('options');
    assert.equal(needs.options, true);
    assert.equal(needs.history, true);
  });

  it('fundamentals intent needs fundamentals data', () => {
    const needs = intentNeedsData('fundamentals');
    assert.equal(needs.fundamentals, true);
    assert.equal(needs.benchmark, false);
  });

  it('comparison intent needs benchmark', () => {
    const needs = intentNeedsData('comparison');
    assert.equal(needs.benchmark, true);
  });
});

describe('INTENTS', () => {
  it('exports known intent types', () => {
    assert.ok(INTENTS.includes('comparison'));
    assert.ok(INTENTS.includes('options'));
    assert.ok(INTENTS.includes('fundamentals'));
    assert.ok(INTENTS.includes('risk'));
    assert.ok(INTENTS.includes('macro'));
    assert.ok(INTENTS.includes('portfolio'));
  });
});
