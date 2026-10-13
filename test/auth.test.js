import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { PrivateOAuthProvider } from '../src/auth.js';
import { createHttpApp } from '../src/http.js';
import { loadConfig } from '../src/lib/config.js';

const origin = 'https://private.example.com';
const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
const password = 'test-only-owner-password-with-32-chars';
const logger = { info() {}, error() {}, warn() {}, debug() {} };
const running = [];
afterEach(async () => {
  for (const { server, transports } of running.splice(0)) {
    for (const transport of transports.values()) await transport.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function start(overrides = {}) {
  const config = loadConfig({ transport: 'http' });
  Object.assign(config.auth, { publicUrl: origin, ownerPassword: password, apiKeys: ['key-a', 'key-b'] }, overrides.auth);
  Object.assign(config.sessions, overrides.sessions);
  const { app, transports, oauth } = createHttpApp({ config, logger });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  running.push({ server, transports });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options) => fetch(base + path, { redirect: 'manual', ...options });
  return { request, config, oauth };
}

const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
const post = (body, token, extra = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body) });
const form = (body, extra = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...extra }, body: new URLSearchParams(body).toString() });

describe('private HTTP and OAuth', () => {
  it('refuses unconfigured HTTP and weak OAuth passwords', () => {
    const config = loadConfig({ transport: 'http' });
    assert.throws(() => createHttpApp({ config, logger }), /unauthenticated HTTP is disabled/);
    config.auth.publicUrl = origin; config.auth.ownerPassword = 'short';
    assert.throws(() => createHttpApp({ config, logger }), /at least 32/);
  });

  it('protects every MCP method, while exposing minimal health and OAuth discovery', async () => {
    const { request } = await start();
    for (const method of ['POST', 'GET', 'DELETE']) {
      const res = await request('/mcp', { method });
      assert.equal(res.status, 401);
      assert.match(res.headers.get('www-authenticate'), /oauth-protected-resource\/mcp/);
    }
    assert.deepEqual(await (await request('/health')).json(), { status: 'ok', server: 'yahoohoo', version: '0.2.0' });
    const metadata = await (await request('/.well-known/oauth-authorization-server')).json();
    assert.equal(metadata.authorization_response_iss_parameter_supported, true);
    assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
    assert.ok(metadata.scopes_supported.includes('offline_access'));
    assert.equal(metadata.registration_endpoint, origin + '/register');
    const resource = await (await request('/.well-known/oauth-protected-resource/mcp')).json();
    assert.equal(resource.resource, origin + '/mcp');
    assert.deepEqual(resource.authorization_servers, [metadata.issuer]);
  });

  it('rejects unapproved redirect URLs and non-Bearer keys', async () => {
    const { request } = await start();
    const register = await request('/register', post({ redirect_uris: ['https://evil.test/callback'], token_endpoint_auth_method: 'none' }));
    assert.equal(register.status, 400);
    assert.equal((await request('/mcp', { headers: { Authorization: 'key-a' } })).status, 401);
    assert.equal((await request('/mcp', post(init, 'key-a', { Origin: 'https://evil.test' }))).status, 403);
  });

  it('requires browser consent, validates PKCE, consumes codes, rotates refresh tokens and serves tools', async () => {
    const { request } = await start();
    const registration = await request('/register', post({ redirect_uris: [callback], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: '<test-client>' }));
    assert.equal(registration.status, 201);
    const client = await registration.json();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', scope: 'market:read offline_access', resource: origin + '/mcp', state: 'test-state' });
    const authorize = await request('/authorize?' + params);
    assert.equal(authorize.status, 200);
    const html = await authorize.text();
    assert.ok(html.includes('&lt;test-client&gt;'));
    assert.ok(!html.includes(password));
    assert.match(authorize.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const requestId = /name="request_id" value="([^"]+)"/.exec(html)[1];
    const cookie = authorize.headers.get('set-cookie').split(';')[0];
    assert.match(authorize.headers.get('set-cookie'), /Secure/);
    assert.match(authorize.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await request('/consent', form({ request_id: requestId, password }))).status, 403);
    assert.equal((await request('/consent', form({ request_id: requestId, password: 'wrong' }, { Cookie: cookie, Origin: origin }))).status, 403);
    const consent = await request('/consent', form({ request_id: requestId, password }, { Cookie: cookie, Origin: origin }));
    assert.equal(consent.status, 303);
    const redirect = new URL(consent.headers.get('location'));
    assert.equal(redirect.searchParams.get('iss'), origin + '/');
    assert.equal(redirect.searchParams.get('state'), 'test-state');
    const tokenParams = { client_id: client.client_id, grant_type: 'authorization_code', code: redirect.searchParams.get('code'), code_verifier: verifier, redirect_uri: callback, resource: origin + '/mcp' };
    assert.equal((await request('/token', form({ ...tokenParams, code_verifier: 'bad'.repeat(16) }))).status, 400);
    assert.equal((await request('/token', form({ ...tokenParams, resource: 'https://evil.test/mcp' }))).status, 400);
    const tokenResponse = await request('/token', form(tokenParams));
    assert.equal(tokenResponse.status, 200);
    const tokens = await tokenResponse.json();
    assert.ok(tokens.refresh_token); assert.equal(tokens.expires_in, 3600);
    assert.equal((await request('/token', form(tokenParams))).status, 400);
    const session = await request('/mcp', post(init, tokens.access_token));
    assert.equal(session.status, 200);
    const sessionId = session.headers.get('mcp-session-id');
    await request('/mcp', post({ jsonrpc: '2.0', method: 'notifications/initialized' }, tokens.access_token, { 'mcp-session-id': sessionId }));
    const listing = await request('/mcp', post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, tokens.access_token, { 'mcp-session-id': sessionId }));
    const tools = (await listing.json()).result.tools;
    assert.ok(tools.some((t) => t.name === 'yahoo_income_statement'));
    assert.ok(tools.every((t) => t.annotations.readOnlyHint));
    const refreshParams = { client_id: client.client_id, grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource: origin + '/mcp' };
    const renewedResponse = await request('/token', form(refreshParams));
    assert.equal(renewedResponse.status, 200);
    const renewed = await renewedResponse.json();
    assert.notEqual(renewed.refresh_token, tokens.refresh_token);
    assert.equal((await request('/token', form(refreshParams))).status, 400);
    assert.equal((await request('/mcp', post(init, tokens.access_token))).status, 401);
    assert.equal((await request('/mcp', post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, renewed.access_token, { 'mcp-session-id': sessionId }))).status, 200);
    assert.equal((await request('/revoke', form({ client_id: client.client_id, token: renewed.refresh_token }))).status, 200);
    assert.equal((await request('/mcp', post(init, renewed.access_token))).status, 401);
  });

  it('returns iss on authorization errors as well as successful consent', async () => {
    const { request } = await start();
    const client = await (await request('/register', post({ redirect_uris: [callback], token_endpoint_auth_method: 'none' }))).json();
    const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: 'code', code_challenge: 'test', code_challenge_method: 'S256', scope: 'admin', state: 'state' });
    const res = await request('/authorize?' + query);
    const target = new URL(res.headers.get('location'));
    assert.equal(target.searchParams.get('iss'), origin + '/');
    assert.equal(target.searchParams.get('error'), 'invalid_scope');
  });

  it('binds sessions to a principal and expires idle sessions', async () => {
    const { request, config } = await start();
    const initialized = await request('/mcp', post(init, 'key-a'));
    const id = initialized.headers.get('mcp-session-id');
    assert.equal((await request('/mcp', { headers: { Authorization: 'Bearer key-b', 'mcp-session-id': id } })).status, 404);
    assert.equal((await request('/mcp', { method: 'DELETE', headers: { Authorization: 'Bearer key-b', 'mcp-session-id': id } })).status, 404);
    config.sessions.idleTtlMs = 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await request('/mcp', { headers: { Authorization: 'Bearer key-a', 'mcp-session-id': id } })).status, 404);
  });

  it('does not let forwarded IP headers bypass rate limits', async () => {
    const { request, config } = await start({ auth: { rateLimitPerMinute: 2 } });
    for (const spoofed of ['1.2.3.4', '2.3.4.5']) {
      await request('/mcp', { headers: { Authorization: 'Bearer key-a', 'X-Forwarded-For': spoofed } });
    }
    const blocked = await request('/mcp', { headers: { Authorization: 'Bearer key-a', 'X-Forwarded-For': '3.4.5.6' } });
    assert.equal(blocked.status, 429); assert.ok(blocked.headers.get('retry-after'));
  });

  it('expires tokens and scopes refresh grants to their registered client', async () => {
    let now = Date.now();
    const oauth = new PrivateOAuthProvider({ publicUrl: origin, ownerPassword: password, redirectUris: [callback] }, () => now);
    const issued = oauth.issue('client-a');
    await assert.rejects(oauth.exchangeRefreshToken({ client_id: 'client-b' }, issued.refresh_token), /Invalid refresh/);
    now += 3600_001;
    await assert.rejects(oauth.verifyAccessToken(issued.access_token), /expired/);
    now += 7 * 86400_000;
    await assert.rejects(oauth.exchangeRefreshToken({ client_id: 'client-a' }, issued.refresh_token), /Invalid refresh/);
  });
});
