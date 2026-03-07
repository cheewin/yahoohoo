import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stableStringify, extractJsonObject } from '../../src/lib/json.js';

describe('stableStringify', () => {
  it('sorts object keys', () => {
    const result = stableStringify({ b: 2, a: 1 });
    const parsed = JSON.parse(result);
    assert.deepEqual(Object.keys(parsed), ['a', 'b']);
  });

  it('handles Date objects', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const result = stableStringify({ when: d });
    assert.ok(result.includes('2026-01-01'));
  });

  it('handles bigint', () => {
    const result = stableStringify({ n: 42n });
    assert.ok(result.includes('"42"'));
  });
});

describe('extractJsonObject', () => {
  it('extracts from fenced code blocks', () => {
    const text = 'Here is the result:\n```json\n{"key": "value"}\n```\nDone.';
    assert.deepEqual(extractJsonObject(text), { key: 'value' });
  });

  it('extracts from raw JSON in text', () => {
    const text = 'The answer is {"summary": "good", "score": 42} and more text.';
    assert.deepEqual(extractJsonObject(text), { summary: 'good', score: 42 });
  });

  it('throws for empty text', () => {
    assert.throws(() => extractJsonObject(''), /No text/);
    assert.throws(() => extractJsonObject(null), /No text/);
  });

  it('throws for text without JSON', () => {
    assert.throws(() => extractJsonObject('No JSON here at all'), /Could not extract/);
  });

  it('handles nested objects', () => {
    const text = '{"outer": {"inner": [1, 2, 3]}}';
    const result = extractJsonObject(text);
    assert.deepEqual(result.outer.inner, [1, 2, 3]);
  });
});
