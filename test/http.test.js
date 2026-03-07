import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHttpApp } from '../src/http.js';
import { loadConfig } from '../src/lib/config.js';
import { createLogger } from '../src/lib/logger.js';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function startServer({ guardHost = '127.0.0.1', allowedHosts, apiKeys, rateLimitPerMinute, maxSessions } = {}) {
  const config = loadConfig({ transport: 'http' });
  config.server.host = guardHost;
  if (allowedHosts) config.server.allowedHosts = allowedHosts;
  if (apiKeys) config.auth.apiKeys = apiKeys;
  if (rateLimitPerMinute != null) config.auth.rateLimitPerMinute = rateLimitPerMinute;
  if (maxSessions != null) config.sessions.maxSessions = maxSessions;

  const logger = createLogger('error');
  const { app } = createHttpApp({ config, logger });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  servers.push(server);

  const address = server.address();
  return {
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function rawRequest({ port, path, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
          });
        });
      },
    );

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('HTTP transport', () => {
  it('serves /health with readiness metadata', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      status: 'ok',
      server: 'yahoohoo',
      version: '0.2.0',
      sessions: 0,
    });
  });

  it('rejects POST /mcp requests without initialize or a session id', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    });

    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, -32000);
    assert.match(body.error.message, /No valid session ID/);
  });

  it('rejects GET /mcp without a known session id', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/mcp`);
    const body = await response.text();

    assert.equal(response.status, 400);
    assert.match(body, /Invalid or missing MCP session ID/);
  });

  it('enforces the host allow-list when configured for open binds', async () => {
    const { port } = await startServer({
      guardHost: '0.0.0.0',
      allowedHosts: ['allowed.test'],
    });

    const blocked = await rawRequest({
      port,
      path: '/health',
      headers: {
        Host: 'evil.test',
      },
    });
    assert.equal(blocked.statusCode, 403);
    assert.match(blocked.body, /allow-list/);

    const allowed = await rawRequest({
      port,
      path: '/health',
      headers: {
        Host: 'allowed.test',
      },
    });
    assert.equal(allowed.statusCode, 200);
  });

  it('initializes a new MCP session over HTTP', async () => {
    const { port } = await startServer();

    const response = await rawRequest({
      port,
      path: '/mcp',
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {
            name: 'yahoohoo-test-client',
            version: '1.0.0',
          },
        },
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.ok(response.headers['mcp-session-id']);
    assert.match(response.body, /"protocolVersion":"2025-06-18"/);
  });

  it('returns X-Request-Id header on all responses', async () => {
    const { port } = await startServer();

    const response = await rawRequest({ port, path: '/health' });
    assert.equal(response.statusCode, 200);
    assert.ok(response.headers['x-request-id']);
    assert.equal(response.headers['x-request-id'].length, 8);
  });

  it('rejects requests without API key when keys are configured', async () => {
    const { port } = await startServer({ apiKeys: ['test-key-123'] });

    const noAuth = await rawRequest({
      port,
      path: '/mcp',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(noAuth.statusCode, 401);
    assert.match(noAuth.body, /Missing Authorization/);
  });

  it('rejects requests with wrong API key', async () => {
    const { port } = await startServer({ apiKeys: ['correct-key'] });

    const wrongKey = await rawRequest({
      port,
      path: '/mcp',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer wrong-key',
      },
      body: '{}',
    });
    assert.equal(wrongKey.statusCode, 403);
    assert.match(wrongKey.body, /Invalid API key/);
  });

  it('allows requests with correct API key', async () => {
    const { port } = await startServer({ apiKeys: ['my-secret-key'] });

    const response = await rawRequest({
      port,
      path: '/mcp',
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        Authorization: 'Bearer my-secret-key',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.ok(response.headers['mcp-session-id']);
  });

  it('allows /health without API key even when keys are configured', async () => {
    const { port } = await startServer({ apiKeys: ['secret'] });

    const response = await rawRequest({ port, path: '/health' });
    assert.equal(response.statusCode, 200);
  });

  it('enforces rate limits', async () => {
    const { port } = await startServer({ rateLimitPerMinute: 2 });

    const r1 = await rawRequest({ port, path: '/mcp' });
    assert.equal(r1.headers['x-ratelimit-limit'], '2');
    assert.equal(r1.headers['x-ratelimit-remaining'], '1');

    const r2 = await rawRequest({ port, path: '/mcp' });
    assert.equal(r2.headers['x-ratelimit-remaining'], '0');

    const r3 = await rawRequest({ port, path: '/mcp' });
    assert.equal(r3.statusCode, 429);
    assert.match(r3.body, /Rate limit exceeded/);
  });

  it('does not rate limit /health', async () => {
    const { port } = await startServer({ rateLimitPerMinute: 1 });

    const r1 = await rawRequest({ port, path: '/health' });
    assert.equal(r1.statusCode, 200);
    const r2 = await rawRequest({ port, path: '/health' });
    assert.equal(r2.statusCode, 200);
    const r3 = await rawRequest({ port, path: '/health' });
    assert.equal(r3.statusCode, 200);
  });

  it('rejects new sessions when session limit is reached', async () => {
    const { port } = await startServer({ maxSessions: 1 });

    // First session succeeds
    const r1 = await rawRequest({
      port,
      path: '/mcp',
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      }),
    });
    assert.equal(r1.statusCode, 200);

    // Second session rejected
    const r2 = await rawRequest({
      port,
      path: '/mcp',
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test2', version: '1.0.0' },
        },
      }),
    });
    assert.equal(r2.statusCode, 503);
    assert.match(r2.body, /session limit/i);
  });
});
