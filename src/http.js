import express from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import * as streamable from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createYahoohooServer } from './server.js';
import { generateRequestId, startTimer } from './lib/logger.js';
import { AuthError, RateLimitError, SessionLimitError, errorToJsonRpc } from './lib/errors.js';

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

    const provided = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
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

    const clientKey = req.ip || 'unknown';
    const now = Date.now();
    let entry = windows.get(clientKey);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      windows.set(clientKey, entry);
    }
    entry.count += 1;

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - entry.count)));

    if (entry.count > limit) {
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

  const app = express();
  const transports = new Map();

  app.use(requestLogger(logger));
  app.use(express.json({ limit: '2mb' }));
  app.use(hostGuard(config));
  app.use(apiKeyAuth(config));
  app.use(rateLimiter(config));

  app.post('/mcp', async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'];
      let transport = sessionId ? transports.get(String(sessionId)) : null;

      if (!transport && isInitializeRequest(req.body)) {
        const maxSessions = config.sessions.maxSessions;
        if (maxSessions > 0 && transports.size >= maxSessions) {
          const err = new SessionLimitError(maxSessions);
          res.status(err.httpStatus).json(errorToJsonRpc(err, req.body?.id ?? null));
          return;
        }

        transport = new NodeHttpTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) transports.delete(transport.sessionId);
        };
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
    }
  });

  const sessionHandler = async (req, res) => {
    const sessionId = String(req.headers['mcp-session-id'] || '');
    const transport = transports.get(sessionId);
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
      sessions: transports.size,
    });
  });

  return { app, transports };
}

export function listenHttp({ config, logger }) {
  const { app, transports } = createHttpApp({ config, logger });
  const server = app.listen(config.server.port, config.server.host, () => {
    logger.info(
      `Yahoohoo HTTP transport listening at http://${config.server.host}:${config.server.port}/mcp`,
    );
    logger.info(`Health endpoint at http://${config.server.host}:${config.server.port}/health`);
    if (config.auth.apiKeys.length) {
      logger.info(`API key auth enabled (${config.auth.apiKeys.length} key(s)).`);
    } else {
      logger.warn('No API keys configured (YAHOOHOO_API_KEYS). HTTP mode is unauthenticated.');
    }
  });
  return { app, server, transports };
}
