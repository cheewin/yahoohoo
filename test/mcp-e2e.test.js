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
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function startServer() {
  const config = loadConfig({ transport: 'http' });
  config.server.host = '127.0.0.1';
  const logger = createLogger('error');
  const { app, transports } = createHttpApp({ config, logger });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  servers.push(server);
  const port = server.address().port;
  return { port, transports };
}

function rawRequest({ port, path, method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function mcpRequest(port, sessionId, body) {
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return rawRequest({
    port,
    path: '/mcp',
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function parseResponse(response) {
  const body = response.body;
  // Try plain JSON first (initialize response)
  if (body.startsWith('{')) {
    return JSON.parse(body);
  }
  // Parse SSE format: extract JSON from "data: ..." lines
  const dataLines = body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6));
  for (const line of dataLines) {
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }
  throw new Error(`Could not parse response body: ${body.slice(0, 200)}`);
}

async function initSession(port) {
  const response = await mcpRequest(port, null, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'e2e-test', version: '1.0.0' },
    },
  });
  assert.equal(response.statusCode, 200);
  const sessionId = response.headers['mcp-session-id'];
  assert.ok(sessionId);

  // Send initialized notification
  await mcpRequest(port, sessionId, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });

  return sessionId;
}

describe('MCP end-to-end', () => {
  describe('session lifecycle', () => {
    it('initializes and returns server capabilities', async () => {
      const { port } = await startServer();
      const response = await mcpRequest(port, null, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'e2e-test', version: '1.0.0' },
        },
      });

      assert.equal(response.statusCode, 200);
      const result = parseResponse(response);
      assert.equal(result.result.protocolVersion, '2025-06-18');
      assert.ok(result.result.capabilities);
      assert.ok(result.result.serverInfo);
      assert.equal(result.result.serverInfo.name, 'yahoohoo');
    });

    it('rejects tool calls without a session', async () => {
      const { port } = await startServer();
      const response = await mcpRequest(port, null, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

      assert.equal(response.statusCode, 400);
    });

    it('tracks active sessions and cleans up on close', async () => {
      const { port, transports } = await startServer();
      const sessionId = await initSession(port);
      assert.equal(transports.size, 1);

      // DELETE /mcp closes the session
      await rawRequest({
        port,
        path: '/mcp',
        method: 'DELETE',
        headers: { 'mcp-session-id': sessionId },
      });

      // Give it a moment to clean up
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(transports.size, 0);
    });
  });

  describe('tool listing', () => {
    it('lists all registered tools', async () => {
      const { port } = await startServer();
      const sessionId = await initSession(port);

      const response = await mcpRequest(port, sessionId, {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/list',
        params: {},
      });

      assert.equal(response.statusCode, 200);
      const result = parseResponse(response);
      const toolNames = result.result.tools.map((t) => t.name);
      assert.ok(toolNames.includes('yahoo_search'));
      assert.ok(toolNames.includes('yahoo_quote'));
      assert.ok(toolNames.includes('yahoo_historical'));
      assert.ok(toolNames.includes('yahoo_quote_summary'));
      assert.ok(toolNames.includes('yahoo_options'));
      assert.ok(toolNames.includes('yahoohoo_analyze'));
      assert.ok(toolNames.includes('yahoo_screener'));
      assert.ok(toolNames.includes('yahoo_trending'));
      assert.ok(toolNames.includes('yahoo_insights'));
      assert.ok(toolNames.includes('yahoohoo_peek'));
      assert.ok(toolNames.includes('yahoohoo_drill'));
      assert.equal(toolNames.length, 11);
    });

    it('tools have valid input schemas', async () => {
      const { port } = await startServer();
      const sessionId = await initSession(port);

      const response = await mcpRequest(port, sessionId, {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/list',
        params: {},
      });

      const result = parseResponse(response);
      for (const tool of result.result.tools) {
        assert.ok(tool.name, 'tool has name');
        assert.ok(tool.inputSchema, `${tool.name} has inputSchema`);
        assert.equal(tool.inputSchema.type, 'object', `${tool.name} schema is object`);
      }
    });
  });

  describe('prompt listing', () => {
    it('lists registered prompts', async () => {
      const { port } = await startServer();
      const sessionId = await initSession(port);

      const response = await mcpRequest(port, sessionId, {
        jsonrpc: '2.0',
        id: 20,
        method: 'prompts/list',
        params: {},
      });

      assert.equal(response.statusCode, 200);
      const result = parseResponse(response);
      const promptNames = result.result.prompts.map((p) => p.name);
      assert.ok(promptNames.includes('market_study_prompt'));
    });

    it('gets a prompt with arguments', async () => {
      const { port } = await startServer();
      const sessionId = await initSession(port);

      const response = await mcpRequest(port, sessionId, {
        jsonrpc: '2.0',
        id: 21,
        method: 'prompts/get',
        params: {
          name: 'market_study_prompt',
          arguments: {
            objective: 'analyze tech stocks',
            symbols: 'AAPL, MSFT',
          },
        },
      });

      assert.equal(response.statusCode, 200);
      const result = parseResponse(response);
      assert.ok(result.result.messages);
      assert.equal(result.result.messages.length, 1);
      assert.ok(result.result.messages[0].content.text.includes('analyze tech stocks'));
      assert.ok(result.result.messages[0].content.text.includes('AAPL, MSFT'));
    });
  });

  describe('resource listing', () => {
    it('lists resource templates', async () => {
      const { port } = await startServer();
      const sessionId = await initSession(port);

      const response = await mcpRequest(port, sessionId, {
        jsonrpc: '2.0',
        id: 25,
        method: 'resources/templates/list',
        params: {},
      });

      assert.equal(response.statusCode, 200);
      const result = parseResponse(response);
      const templates = result.result.resourceTemplates;
      assert.ok(Array.isArray(templates));
      assert.ok(templates.some((t) => t.uriTemplate.includes('yahoohoo://analysis/')));
    });
  });

  describe('tool call errors', () => {
    it('returns error for unknown tool', async () => {
      const { port } = await startServer();
      const sessionId = await initSession(port);

      const response = await mcpRequest(port, sessionId, {
        jsonrpc: '2.0',
        id: 30,
        method: 'tools/call',
        params: {
          name: 'nonexistent_tool',
          arguments: {},
        },
      });

      assert.equal(response.statusCode, 200);
      const result = parseResponse(response);
      // MCP SDK returns tool errors as result.isError, not jsonrpc error
      assert.ok(result.result?.isError || result.error);
    });

    it('returns error for invalid tool arguments', async () => {
      const { port } = await startServer();
      const sessionId = await initSession(port);

      const response = await mcpRequest(port, sessionId, {
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/call',
        params: {
          name: 'yahoo_search',
          arguments: { query: '' },
        },
      });

      assert.equal(response.statusCode, 200);
      const result = parseResponse(response);
      assert.ok(result.result?.isError || result.error);
    });
  });

  describe('multiple sessions', () => {
    it('supports concurrent independent sessions', async () => {
      const { port, transports } = await startServer();
      const session1 = await initSession(port);
      const session2 = await initSession(port);

      assert.notEqual(session1, session2);
      assert.equal(transports.size, 2);

      // Both sessions can list tools independently
      const [r1, r2] = await Promise.all([
        mcpRequest(port, session1, { jsonrpc: '2.0', id: 40, method: 'tools/list', params: {} }),
        mcpRequest(port, session2, { jsonrpc: '2.0', id: 41, method: 'tools/list', params: {} }),
      ]);

      assert.equal(r1.statusCode, 200);
      assert.equal(r2.statusCode, 200);

      const tools1 = parseResponse(r1).result.tools;
      const tools2 = parseResponse(r2).result.tools;
      assert.equal(tools1.length, tools2.length);
    });
  });

  describe('invalid JSON-RPC', () => {
    it('handles malformed JSON gracefully', async () => {
      const { port } = await startServer();
      const sessionId = await initSession(port);

      const response = await rawRequest({
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-session-id': sessionId,
        },
        body: '{not valid json',
      });

      // Express should return 400 for parse failure
      assert.ok(response.statusCode >= 400);
    });

    it('handles missing method field', async () => {
      const { port } = await startServer();
      const sessionId = await initSession(port);

      const response = await mcpRequest(port, sessionId, {
        jsonrpc: '2.0',
        id: 50,
      });

      // SDK may return error as JSON or SSE, or 400
      const result = parseResponse(response);
      assert.ok(result.error || response.statusCode >= 400);
    });
  });
});
