#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { listenHttp } from './http.js';
import { loadConfig } from './lib/config.js';
import { createLogger } from './lib/logger.js';
import { createYahoohooServer } from './server.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--transport') args.transport = argv[i + 1];
  }
  return args;
}

async function runStdio(config, logger) {
  const { server } = createYahoohooServer({ config, logger });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Yahoohoo listening on stdio transport.');

  return {
    async shutdown() {
      try { await server.close(); } catch { /* ignore */ }
    },
  };
}

async function runHttp(config, logger) {
  const { server, transports } = listenHttp({ config, logger });

  return {
    async shutdown() {
      // Stop accepting new connections
      await new Promise((resolve) => server.close(resolve));

      // Close all MCP transport sessions
      for (const transport of transports.values()) {
        try { await transport.close?.(); } catch { /* ignore */ }
      }
    },
  };
}

function installShutdownHandler({ handle, config, logger }) {
  let shuttingDown = false;

  const onSignal = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, starting graceful shutdown…`);

    const drainTimeout = setTimeout(() => {
      logger.warn(`Drain timeout (${config.shutdown.drainTimeoutMs}ms) exceeded, forcing exit.`);
      process.exit(1);
    }, config.shutdown.drainTimeoutMs);
    drainTimeout.unref();

    try {
      await handle.shutdown();
      logger.info('Graceful shutdown complete.');
    } catch (error) {
      logger.error('Error during shutdown:', error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(drainTimeout);
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args);
  const logger = createLogger(config.logging.level);

  let handle;
  if (config.server.transport === 'http') {
    handle = await runHttp(config, logger);
  } else {
    handle = await runStdio(config, logger);
  }

  installShutdownHandler({ handle, config, logger });
}

main().catch((error) => {
  console.error('Yahoohoo failed to start:', error);
  process.exit(1);
});
