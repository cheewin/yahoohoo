import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isoDate, resolveDateRange, inferInterval, validateInterval, VALID_INTERVALS } from '../../src/lib/dates.js';

describe('isoDate', () => {
  it('formats a Date to YYYY-MM-DD', () => {
    assert.equal(isoDate('2026-03-15T12:30:00Z'), '2026-03-15');
  });

  it('handles date-only strings', () => {
    assert.equal(isoDate('2026-01-01'), '2026-01-01');
  });
});

describe('resolveDateRange', () => {
  it('returns explicit from/to', () => {
    const range = resolveDateRange({ from: '2025-06-01', to: '2026-01-01' });
    assert.equal(range.from, '2025-06-01');
    assert.equal(range.to, '2026-01-01');
  });

  it('defaults to lookbackDays when from is missing', () => {
    const range = resolveDateRange({ to: '2026-03-01', lookbackDays: 30 });
    assert.equal(range.to, '2026-03-01');
    assert.equal(range.from, '2026-01-30');
  });

  it('throws on invalid dates', () => {
    assert.throws(() => resolveDateRange({ from: 'not-a-date', to: '2026-01-01' }), /Invalid/);
  });

  it('throws when from > to', () => {
    assert.throws(() => resolveDateRange({ from: '2026-06-01', to: '2026-01-01' }), /earlier/);
  });
});

describe('inferInterval', () => {
  it('returns requested interval when valid', () => {
    assert.equal(inferInterval({ from: '2026-01-01', to: '2026-03-01', requestedInterval: '1d' }), '1d');
  });

  it('throws on invalid requested interval', () => {
    assert.throws(() => inferInterval({ from: '2026-01-01', to: '2026-03-01', requestedInterval: '2d' }), /Invalid interval/);
  });

  it('infers 1h for ranges <= 10 days', () => {
    assert.equal(inferInterval({ from: '2026-03-01', to: '2026-03-05' }), '1h');
  });

  it('infers 1d for ranges <= 60 days', () => {
    assert.equal(inferInterval({ from: '2026-01-01', to: '2026-02-15' }), '1d');
  });

  it('infers 1wk for ranges > 60 days', () => {
    assert.equal(inferInterval({ from: '2025-01-01', to: '2026-01-01' }), '1wk');
  });
});

describe('validateInterval', () => {
  it('returns valid intervals unchanged', () => {
    for (const iv of VALID_INTERVALS) {
      assert.equal(validateInterval(iv), iv);
    }
  });

  it('returns undefined for falsy input', () => {
    assert.equal(validateInterval(undefined), undefined);
    assert.equal(validateInterval(null), undefined);
    assert.equal(validateInterval(''), undefined);
  });

  it('throws for invalid intervals', () => {
    assert.throws(() => validateInterval('2d'), /Invalid interval/);
    assert.throws(() => validateInterval('weekly'), /Invalid interval/);
  });
});
