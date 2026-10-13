import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.env.YAHOOHOO_SMOKE_URL || 'http://127.0.0.1:3434/mcp');
const token = process.env.YAHOOHOO_SMOKE_TOKEN;
if (!token) throw new Error('Set YAHOOHOO_SMOKE_TOKEN securely in the environment.');
const timeout = { signal: AbortSignal.timeout(15_000) };
const health = await fetch(new URL('/health', url), timeout);
assert.equal(health.status, 200);
assert.equal((await health.json()).status, 'ok');
const unauthenticated = await fetch(url, { ...timeout, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(unauthenticated.status, 401, 'MCP must reject unauthenticated requests');
const client = new Client({ name: 'private-finance-smoke', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  for (const name of ['yahoo_quote', 'yahoo_historical', 'yahoo_news', 'yahoo_income_statement', 'yahoo_balance_sheet', 'yahoo_cash_flow', 'yahoo_options', 'crypto_markets', 'yahoohoo_analyze']) {
    assert.ok(tools.tools.some((t) => t.name === name), `${name} missing`);
  }
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
    assert.ok(!result.isError, `${name} failed: ${JSON.stringify(result.content)}`);
    console.log(`${name}: passed`);
    return result.structuredContent ?? result;
  };
  const quotes = await call('yahoo_quote', { symbols: ['AAPL', 'SPY', '^GSPC', 'BTC-USD'] });
  for (const symbol of ['AAPL', 'SPY', '^GSPC', 'BTC-USD']) {
    assert.ok(!quotes[symbol].error && quotes[symbol].regularMarketPrice > 0, `${symbol} quote unavailable`);
    assert.ok(Date.parse(quotes[symbol].regularMarketTime));
  }
  const from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const history = await call('yahoo_historical', { symbol: 'AAPL', from });
  assert.ok(history.bars.length >= 5);
  const news = await call('yahoo_news', { symbol: 'AAPL', limit: 3 });
  assert.ok(news.articles.length);
  for (const name of ['yahoo_income_statement', 'yahoo_balance_sheet', 'yahoo_cash_flow']) {
    const data = await call(name, { symbol: 'AAPL', frequency: 'annual' });
    assert.ok(data.periods.length);
  }
  const options = await call('yahoo_options', { symbol: 'SPY' });
  assert.ok(options.calls.length && options.puts.length);
  const crypto = await call('crypto_markets', { count: 5 });
  assert.ok(JSON.stringify(crypto).includes('BTC'));
  const analysis = await call('yahoohoo_analyze', { query: 'compare AAPL and SPY', symbols: ['AAPL', 'SPY'], from, reasoningMode: 'heuristic', maxDepth: 0, compact: false });
  assert.ok(analysis.runId);
  assert.ok(!analysis.dataErrors.length, 'Analysis must not hide provider failures');
  assert.ok(analysis.metrics.symbols.AAPL.history.bars >= 5 && analysis.metrics.symbols.SPY.history.bars >= 5);
  console.log('Authenticated MCP functional smoke test passed.');
} finally {
  await transport.terminateSession().catch(() => {});
  await client.close();
}
