import express from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import * as streamable from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createYahoohooServer } from './server.js';
import { generateRequestId, startTimer } from './lib/logger.js';
import { AuthError, RateLimitError, SessionLimitError, errorToJsonRpc } from './lib/errors.js';
import { installOAuth, fingerprint, secretEqual } from './auth.js';

const NodeHttpTransport =
  streamable.NodeStreamableHTTPServerTransport || streamable.StreamableHTTPServerTransport;

export { NodeHttpTransport };

export function hostGuard(config) {
  return (req, res, next) => {
    const rawHost = String(req.headers.host || '');
    const hostname = rawHost.split(':')[0];
    const openBind = config.server.host === '0.0.0.0' || config.server.host === '::';
    if (!openBind) return next();
    if (config.server.allowedHosts.includes(hostname)) return next();
    res.status(403).json({ error: 'Host header rejected by Yahoohoo allow-list.' });
  };
}

function safeCompare(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function apiKeyAuth(config) {
  const keys = config.auth.apiKeys;
  return (req, res, next) => {
    if (!keys.length) return next();
    if (req.path === '/health') return next();

    const provided = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1] || '';
    if (!provided) {
      const err = new AuthError('Missing Authorization header. Use: Bearer <api-key>', 401);
      res.status(err.httpStatus).json(err.toJSON());
      return;
    }
    const valid = keys.some((key) => safeCompare(provided, key));
    if (!valid) {
      const err = new AuthError('Invalid API key.', 403);
      res.status(err.httpStatus).json(err.toJSON());
      return;
    }
    req.principal = `key:${fingerprint(provided)}`;
    next();
  };
}

export function rateLimiter(config) {
  const limit = config.auth.rateLimitPerMinute;
  if (!limit || limit <= 0) return (_req, _res, next) => next();

  const windows = new Map();
  const windowMs = 60_000;

  return (req, res, next) => {
    if (req.path === '/health') return next();

    const clientKey = req.principal || req.ip || 'unknown';
    const now = Date.now();
    for (const [key, value] of windows) if (now - value.start >= windowMs) windows.delete(key);
    let entry = windows.get(clientKey);
    if (!entry || now - entry.start >= windowMs) {
      if (windows.size >= 500) {
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ error: 'RATE_LIMIT' });
      }
      entry = { start: now, count: 0 };
      windows.set(clientKey, entry);
    }
    entry.count += 1;

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - entry.count)));

    if (entry.count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.start + windowMs - now) / 1000))));
      const err = new RateLimitError();
      res.status(err.httpStatus).json(err.toJSON());
      return;
    }
    next();
  };
}

export function requestLogger(logger) {
  return (req, res, next) => {
    const requestId = generateRequestId();
    const timer = startTimer();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      const ms = timer.elapsedMs().toFixed(1);
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level](`${req.method} ${req.path} ${res.statusCode} ${ms}ms [${requestId}]`);
    });

    next();
  };
}

export function createHttpApp({ config, logger }) {
  if (!NodeHttpTransport) {
    throw new Error('The installed MCP SDK does not expose a Streamable HTTP transport.');
  }

  const oauthEnabled = Boolean(config.auth.publicUrl || config.auth.ownerPassword);
  if (oauthEnabled) {
    const url = new URL(config.auth.publicUrl);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new Error('YAHOOHOO_PUBLIC_URL must be an HTTPS origin without credentials, path, query or fragment.');
    }
    if (!config.auth.ownerPassword || config.auth.ownerPassword.length < 32) throw new Error('Set YAHOOHOO_OWNER_PASSWORD to a random secret of at least 32 characters.');
    for (const uri of config.auth.redirectUris) {
      const callback = new URL(uri);
      if (callback.protocol !== 'https:' || callback.username || callback.password || callback.hash) throw new Error('OAuth callback URLs must use HTTPS.');
    }
  }
  if (!oauthEnabled && !config.auth.apiKeys.length) throw new Error('HTTP requires OAuth or YAHOOHOO_API_KEYS; unauthenticated HTTP is disabled.');
  if (!Number.isInteger(config.auth.rateLimitPerMinute) || config.auth.rateLimitPerMinute <= 0) throw new Error('HTTP requires a positive rate limit.');
  if (config.sessions.maxSessions <= 0 || config.sessions.idleTtlMs <= 0) throw new Error('HTTP requires bounded sessions and a positive idle TTL.');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false); // Never trust arbitrary forwarded IP or host headers.
  const transports = new Map();
  const owners = new Map();
  let initializing = 0;
  let analyses = 0;

  app.use(requestLogger(logger));
  app.use(hostGuard(config));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (oauthEnabled) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  // One perimeter budget per direct peer; forwarded IPs are intentionally ignored.
  app.use(rateLimiter({ auth: { rateLimitPerMinute: 120 } }));
  app.use(express.json({ limit: '256kb' }));
  const oauth = oauthEnabled ? installOAuth(app, config) : null;
  app.use('/mcp', (req, res, next) => {
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1];
    if (token && config.auth.apiKeys.some((key) => secretEqual(token, key))) {
      req.principal = `key:${fingerprint(token)}`;
      return next();
    }
    if (!oauth) return apiKeyAuth(config)(req, res, next);
    oauth.bearer(req, res, () => { req.principal = `oauth:${req.auth.clientId}`; next(); });
  });
  app.use('/mcp', (req, res, next) => {
    if (req.headers.origin && (!oauthEnabled || req.headers.origin !== new URL(config.auth.publicUrl).origin)) {
      return res.status(403).json({ error: 'Origin rejected.' });
    }
    next();
  });
  app.use(rateLimiter(config));
  app.post('/mcp', (req, res, next) => {
    if (req.body?.method !== 'tools/call' || !['yahoohoo_analyze', 'yahoohoo_drill'].includes(req.body.params?.name)) return next();
    if (analyses >= 1) {
      res.setHeader('Retry-After', '5');
      return res.status(429).json({ error: 'ANALYSIS_BUSY', message: 'One analysis is already running. Retry shortly.' });
    }
    analyses++;
    // Hold the slot until execution finishes, even if the client disconnects.
    req.releaseAnalysis = () => { analyses--; };
    next();
  });

  const sessionFor = (req, res) => {
    for (const [id, entry] of owners) {
      if (Date.now() - entry.usedAt >= config.sessions.idleTtlMs) {
        void transports.get(id)?.close().catch(() => {});
        transports.delete(id); owners.delete(id);
      }
    }
    const id = String(req.headers['mcp-session-id'] || '');
    if (!id) return null;
    const owner = owners.get(id);
    if (!owner || owner.principal !== req.principal) {
      res.status(404).json({ error: 'Unknown MCP session.' });
      return null;
    }
    owner.usedAt = Date.now();
    return transports.get(id);
  };

  app.post('/mcp', async (req, res) => {
    let newTransport;
    let reserved = false;
    try {
      let transport = sessionFor(req, res);
      if (res.headersSent) return;

      if (!transport && isInitializeRequest(req.body)) {
        const maxSessions = config.sessions.maxSessions;
        if (transports.size + initializing >= maxSessions) {
          const err = new SessionLimitError(maxSessions);
          res.status(err.httpStatus).json(errorToJsonRpc(err, req.body?.id ?? null));
          return;
        }
        initializing++;
        reserved = true;
        transport = new NodeHttpTransport({
          enableJsonResponse: true,
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
            owners.set(id, { principal: req.principal, usedAt: Date.now() });
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) { transports.delete(transport.sessionId); owners.delete(transport.sessionId); }
        };
        newTransport = transport;
        const { server } = createYahoohooServer({ config, logger });
        await server.connect(transport);
      }

      if (!transport) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'No valid session ID provided.',
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (res.headersSent) return;
      logger.error('Yahoohoo HTTP request failed:', error instanceof Error ? error.message : String(error));
      const status = error.httpStatus || 500;
      res.status(status).json(errorToJsonRpc(error, req.body?.id ?? null));
    } finally {
      req.releaseAnalysis?.();
      if (reserved) initializing--;
      if (newTransport && !newTransport.sessionId) await newTransport.close();
    }
  });

  const sessionHandler = async (req, res) => {
    const transport = sessionFor(req, res);
    if (res.headersSent) return;
    if (!transport) {
      res.status(400).send('Invalid or missing MCP session ID.');
      return;
    }
    await transport.handleRequest(req, res, req.body);
  };

  app.get('/mcp', sessionHandler);
  app.delete('/mcp', sessionHandler);

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      server: config.server.name,
      version: config.server.version,
    });
  });

  app.use((error, _req, res, _next) => {
    if (!res.headersSent) res.status(error.status || 500).json({ error: 'Request rejected.' });
  });
  return { app, transports, oauth: oauth?.provider };
}

export function listenHttp({ config, logger }) {
  const { app, transports } = createHttpApp({ config, logger });
  const server = app.listen(config.server.port, config.server.host, () => {
    logger.info(
      `Yahoohoo HTTP transport listening at http://${config.server.host}:${config.server.port}/mcp`,
    );
    logger.info(`Health endpoint at http://${config.server.host}:${config.server.port}/health`);
    logger.info('Private HTTP authentication enabled.');
  });
  return { app, server, transports };
}
