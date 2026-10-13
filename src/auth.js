import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { mcpAuthRouter, createOAuthMetadata, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { InvalidClientMetadataError, InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

const random = () => randomBytes(32).toString('base64url');
export const fingerprint = (value) => createHash('sha256').update(value).digest('hex');
export const secretEqual = (a, b) => timingSafeEqual(Buffer.from(fingerprint(a)), Buffer.from(fingerprint(b)));
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Deliberately single-instance, ephemeral authorization state. Restarting revokes
// all credentials and requires reconnecting ChatGPT; no secrets are written to disk.
export class PrivateOAuthProvider {
  constructor(config, now = Date.now) {
    this.config = config;
    this.now = now;
    this.resource = new URL('/mcp', config.publicUrl).href;
    this.clients = new Map();
    this.pending = new Map();
    this.codes = new Map();
    this.access = new Map();
    this.refresh = new Map();
    this.clientsStore = {
      getClient: async (id) => { this.prune(); return this.clients.get(id)?.client; },
      registerClient: async (client) => {
        this.prune();
        if (this.clients.size >= 100) throw new InvalidClientMetadataError('Client capacity reached; restart to clear registrations.');
        if (!client.redirect_uris?.length || client.redirect_uris.some((uri) => !config.redirectUris.includes(uri))) {
          throw new InvalidClientMetadataError('Only configured ChatGPT callback URLs are allowed.');
        }
        if ((client.grant_types || ['authorization_code']).some((g) => !['authorization_code', 'refresh_token'].includes(g))) {
          throw new InvalidClientMetadataError('Unsupported grant type.');
        }
        const registered = { ...client, client_id: client.client_id || random(), client_id_issued_at: Math.floor(this.now() / 1000) };
        this.clients.set(registered.client_id, { client: registered, expires: this.now() + 30 * 86400_000 });
        return registered;
      },
    };
  }

  prune() {
    for (const map of [this.clients, this.pending, this.codes, this.access, this.refresh]) {
      for (const [id, entry] of map) if (entry.expires <= this.now()) map.delete(id);
    }
  }

  checkResource(resource) {
    if (resource && resource.href !== this.resource) throw new InvalidTargetError('Invalid MCP resource audience.');
  }

  checkScopes(scopes) {
    if (scopes?.some((scope) => !['market:read', 'offline_access'].includes(scope))) throw new InvalidScopeError('Unsupported scope.');
  }

  async authorize(client, params, res) {
    this.prune();
    this.checkResource(params.resource);
    this.checkScopes(params.scopes);
    if (this.pending.size >= 100) throw new InvalidGrantError('Too many pending authorizations.');
    const requestId = random();
    const browserSecret = random();
    this.pending.set(requestId, { clientId: client.client_id, params, browserHash: fingerprint(browserSecret), expires: this.now() + 5 * 60_000 });
    res.cookie('__Host-yahoohoo-consent', browserSecret, { secure: true, httpOnly: true, sameSite: 'lax', path: '/', maxAge: 5 * 60_000 });
    res.set({ 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", 'Referrer-Policy': 'no-referrer' });
    res.type('html').send(`<!doctype html><html><head><title>Authorize Yahoohoo</title></head><body>
      <h1>Connect private market data</h1><p>Allow ${escape(client.client_name || 'MCP client')} to read market data and run analyses.</p>
      <form method="post" action="/consent"><input type="hidden" name="request_id" value="${requestId}">
      <label>Owner password <input type="password" name="password" required autocomplete="current-password"></label>
      <button type="submit">Authorize</button></form></body></html>`);
  }

  consent(req, res) {
    this.prune();
    const entry = this.pending.get(req.body?.request_id);
    const cookie = String(req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith('__Host-yahoohoo-consent='))?.slice('__Host-yahoohoo-consent='.length) || '';
    if (!entry || req.headers.origin !== new URL(this.config.publicUrl).origin || !secretEqual(fingerprint(cookie), entry.browserHash)) {
      return res.status(403).json({ error: 'Invalid or expired consent request.' });
    }
    if (typeof req.body.password !== 'string' || !secretEqual(req.body.password, this.config.ownerPassword)) {
      return res.status(403).json({ error: 'Invalid owner password.' });
    }
    this.pending.delete(req.body.request_id);
    const code = random();
    this.codes.set(fingerprint(code), { ...entry, expires: this.now() + 60_000 });
    const url = new URL(entry.params.redirectUri);
    url.searchParams.set('iss', new URL(this.config.publicUrl).href);
    url.searchParams.set('code', code);
    if (entry.params.state !== undefined) url.searchParams.set('state', entry.params.state);
    res.clearCookie('__Host-yahoohoo-consent', { secure: true, httpOnly: true, sameSite: 'lax', path: '/' });
    res.redirect(303, url.href);
  }

  codeFor(client, code) {
    this.prune();
    const entry = this.codes.get(fingerprint(code));
    if (!entry || entry.clientId !== client.client_id) throw new InvalidGrantError('Invalid authorization code.');
    return entry;
  }

  async challengeForAuthorizationCode(client, code) { return this.codeFor(client, code).params.codeChallenge; }

  issue(clientId) {
    this.prune();
    if (this.access.size >= 500 || this.refresh.size >= 500) throw new InvalidGrantError('Token capacity reached.');
    const accessToken = random();
    const refreshToken = random();
    this.access.set(fingerprint(accessToken), { clientId, expires: this.now() + 3600_000 });
    this.refresh.set(fingerprint(refreshToken), { clientId, accessHash: fingerprint(accessToken), expires: this.now() + 7 * 86400_000 });
    return { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: refreshToken, scope: 'market:read offline_access' };
  }

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    const entry = this.codeFor(client, code);
    this.checkResource(resource);
    if (redirectUri !== entry.params.redirectUri) throw new InvalidGrantError('Redirect URI mismatch.');
    this.codes.delete(fingerprint(code));
    return this.issue(client.client_id);
  }

  async exchangeRefreshToken(client, token, scopes, resource) {
    this.prune();
    this.checkResource(resource);
    this.checkScopes(scopes);
    const entry = this.refresh.get(fingerprint(token));
    if (!entry || entry.clientId !== client.client_id) throw new InvalidGrantError('Invalid refresh token.');
    this.refresh.delete(fingerprint(token));
    this.access.delete(entry.accessHash);
    return this.issue(client.client_id);
  }

  async verifyAccessToken(token) {
    this.prune();
    const entry = this.access.get(fingerprint(token));
    if (!entry) throw new InvalidTokenError('Invalid or expired access token.');
    return { token, clientId: entry.clientId, scopes: ['market:read', 'offline_access'], expiresAt: Math.floor(entry.expires / 1000), resource: this.resource };
  }

  async revokeToken(client, { token }) {
    const hash = fingerprint(token);
    const refresh = this.refresh.get(hash);
    if (refresh?.clientId === client.client_id) { this.refresh.delete(hash); this.access.delete(refresh.accessHash); }
    if (this.access.get(hash)?.clientId === client.client_id) this.access.delete(hash);
  }
}

export function installOAuth(app, config) {
  const provider = new PrivateOAuthProvider(config.auth);
  const options = { provider, issuerUrl: new URL(config.auth.publicUrl), resourceServerUrl: new URL(provider.resource), scopesSupported: ['market:read', 'offline_access'], resourceName: 'Private Yahoohoo' };
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({ ...createOAuthMetadata(options), authorization_response_iss_parameter_supported: true });
  });
  app.use('/authorize', (_req, res, next) => {
    const redirect = res.redirect.bind(res);
    res.redirect = (status, target) => {
      const url = new URL(target);
      if (config.auth.redirectUris.includes(`${url.origin}${url.pathname}`)) url.searchParams.set('iss', options.issuerUrl.href);
      return redirect(status, url.href);
    };
    next();
  });
  app.post('/consent', express.urlencoded({ extended: false, limit: '8kb' }), (req, res) => provider.consent(req, res));
  app.use(mcpAuthRouter(options));
  const bearer = requireBearerAuth({ verifier: provider, requiredScopes: ['market:read'], expectedResource: provider.resource, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(provider.resource)) });
  return { provider, bearer };
}
