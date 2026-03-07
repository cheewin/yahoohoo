import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from '../../src/lib/cache.js';

describe('TtlCache', () => {
  it('stores and retrieves values', () => {
    const cache = new TtlCache(10_000);
    cache.set('key', 'value');
    assert.equal(cache.get('key'), 'value');
  });

  it('returns undefined for missing keys', () => {
    const cache = new TtlCache(10_000);
    assert.equal(cache.get('missing'), undefined);
  });

  it('expires entries after TTL', async () => {
    const cache = new TtlCache(50);
    cache.set('key', 'value');
    assert.equal(cache.get('key'), 'value');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(cache.get('key'), undefined);
  });

  it('memo returns cached value on second call', async () => {
    const cache = new TtlCache(10_000);
    let calls = 0;
    const loader = async () => {
      calls++;
      return 'result';
    };
    const first = await cache.memo('k', loader);
    const second = await cache.memo('k', loader);
    assert.equal(first, 'result');
    assert.equal(second, 'result');
    assert.equal(calls, 1);
  });
});
