import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './tools.js';
import { createMarketDataProvider } from './adapters/index.js';
import { PythonSandbox } from './sandbox/index.js';
import { RecursiveMarketAnalyzer } from './core/analyzer.js';
import { RunStore } from './lib/runStore.js';

export function createYahoohooServer({ config, logger }) {
  const marketData = createMarketDataProvider({
    provider: config.market.dataProvider,
    cacheTtlMs: config.market.cacheTtlMs,
    logger,
  });

  const sandbox = new PythonSandbox({ config, logger });
  const analyzer = new RecursiveMarketAnalyzer({
    config,
    logger,
    marketData,
    sandbox,
  });

  const runStore = new RunStore(config.storage.maxSavedRuns);

  const server = new McpServer({
    name: config.server.name,
    version: config.server.version,
  });

  registerTools({
    server,
    marketData,
    analyzer,
    runStore,
    config,
  });

  return {
    server,
    marketData,
    sandbox,
    analyzer,
    runStore,
  };
}
