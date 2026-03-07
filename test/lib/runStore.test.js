import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RunStore } from '../../src/lib/runStore.js';

describe('RunStore', () => {
  it('saves and retrieves an analysis', () => {
    const store = new RunStore(10);
    const analysis = { question: 'test', symbols: ['AAPL'], summary: 'ok' };
    const id = store.save(analysis);

    assert.ok(id);
    assert.equal(typeof id, 'string');

    const run = store.get(id);
    assert.ok(run);
    assert.equal(run.id, id);
    assert.equal(run.query, 'test');
    assert.deepEqual(run.symbols, ['AAPL']);
    assert.equal(run.analysis, analysis);
    assert.ok(run.createdAt);
  });

  it('lists all saved runs', () => {
    const store = new RunStore(10);
    store.save({ question: 'q1', symbols: ['A'] });
    store.save({ question: 'q2', symbols: ['B'] });

    const list = store.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].query, 'q1');
    assert.equal(list[1].query, 'q2');
    // list should not include full analysis
    assert.equal(list[0].analysis, undefined);
  });

  it('returns null for unknown id', () => {
    const store = new RunStore(10);
    assert.equal(store.get('nonexistent'), null);
  });

  it('evicts oldest when at capacity', () => {
    const store = new RunStore(2);
    const id1 = store.save({ question: 'first', symbols: [] });
    store.save({ question: 'second', symbols: [] });
    store.save({ question: 'third', symbols: [] });

    assert.equal(store.size, 2);
    assert.equal(store.get(id1), null);
    assert.equal(store.list().length, 2);
    assert.equal(store.list()[0].query, 'second');
  });

  it('tracks size correctly', () => {
    const store = new RunStore(100);
    assert.equal(store.size, 0);
    store.save({ question: 'x', symbols: [] });
    assert.equal(store.size, 1);
  });
});
