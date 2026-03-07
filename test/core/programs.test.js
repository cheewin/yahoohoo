import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { programForIntent, listPrograms } from '../../src/core/programs.js';

describe('programForIntent', () => {
  it('returns market_metrics for general intent', () => {
    const p = programForIntent('general');
    assert.equal(p.name, 'market_metrics');
    assert.ok(p.code.length > 100);
  });

  it('returns comparison program for comparison intent', () => {
    const p = programForIntent('comparison');
    assert.equal(p.name, 'comparison');
    assert.ok(p.code.includes('pairwise'));
  });

  it('returns options_analysis for options intent', () => {
    const p = programForIntent('options');
    assert.equal(p.name, 'options_analysis');
    assert.ok(p.code.includes('skew'));
  });

  it('returns fundamentals for fundamentals intent', () => {
    const p = programForIntent('fundamentals');
    assert.equal(p.name, 'fundamentals');
    assert.ok(p.code.includes('valuation'));
  });

  it('returns risk_analysis for risk intent', () => {
    const p = programForIntent('risk');
    assert.equal(p.name, 'risk_analysis');
    assert.ok(p.code.includes('tail_risk'));
  });

  it('falls back to market_metrics for unknown intent', () => {
    const p = programForIntent('unknown_thing');
    assert.equal(p.name, 'market_metrics');
  });
});

describe('listPrograms', () => {
  it('lists all available programs', () => {
    const programs = listPrograms();
    assert.ok(programs.includes('market_metrics'));
    assert.ok(programs.includes('comparison'));
    assert.ok(programs.includes('options_analysis'));
    assert.ok(programs.includes('fundamentals'));
    assert.ok(programs.includes('risk_analysis'));
  });
});
