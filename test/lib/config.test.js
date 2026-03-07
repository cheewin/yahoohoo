import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/lib/config.js';

describe('loadConfig', () => {
  it('returns default config with no overrides', () => {
    const config = loadConfig();
    assert.equal(config.server.name, 'yahoohoo');
    assert.equal(config.server.transport, 'stdio');
    assert.equal(config.server.port, 3434);
    assert.equal(config.market.defaultBenchmark, 'SPY');
    assert.equal(config.recursion.maxDepth, 2);
    assert.equal(config.sandbox.timeoutMs, 20_000);
  });

  it('accepts transport override', () => {
    const config = loadConfig({ transport: 'http' });
    assert.equal(config.server.transport, 'http');
  });

  it('has valid default summary modules', () => {
    const config = loadConfig();
    assert.ok(config.market.quoteSummaryModules.includes('price'));
    assert.ok(config.market.quoteSummaryModules.includes('summaryDetail'));
  });

  it('has auth defaults', () => {
    const config = loadConfig();
    assert.deepEqual(config.auth.apiKeys, []);
    assert.equal(config.auth.rateLimitPerMinute, 60);
  });

  it('has shutdown defaults', () => {
    const config = loadConfig();
    assert.equal(config.shutdown.drainTimeoutMs, 10_000);
  });

  it('has session defaults', () => {
    const config = loadConfig();
    assert.equal(config.sessions.maxSessions, 50);
  });
});
