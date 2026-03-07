import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerTools } from '../src/tools.js';

function makeToolRegistry() {
  const handlers = new Map();
  return {
    handlers,
    server: {
      registerTool(name, _meta, handler) {
        handlers.set(name, handler);
      },
      registerPrompt() {},
      registerResource() {},
    },
  };
}

describe('yahoohoo_peek compatibility', () => {
  it('maps legacy correlation_matrix data to metrics.pairwise', async () => {
    const { handlers, server } = makeToolRegistry();
    registerTools({
      server,
      marketData: {},
      analyzer: {},
      runStore: {
        get: () => ({
          analysis: {
            question: 'risk study',
            symbols: ['QQQ', 'IWM'],
            metrics: {
              correlation_matrix: {
                QQQ_vs_IWM: 0.645,
              },
            },
          },
        }),
        list: () => [],
      },
      config: {
        market: { defaultLookbackDays: 180, quoteSummaryModules: [] },
        recursion: { maxDepth: 2 },
      },
    });

    const peek = handlers.get('yahoohoo_peek');
    const result = await peek({ runId: 'legacy', path: 'metrics.pairwise' });
    const text = result.content[0].text;

    assert.ok(text.includes('"QQQ_vs_IWM"'));
    assert.ok(text.includes('"correlation": 0.645'));
  });

  it('extracts dashboard from stored run via yahoohoo_options_dashboard', async () => {
    const { handlers, server } = makeToolRegistry();
    registerTools({
      server,
      marketData: {},
      analyzer: {},
      runStore: {
        get: () => ({
          analysis: {
            question: 'options dashboard test',
            symbols: ['SPY'],
            metrics: {
              symbols: {
                SPY: {
                  options: {
                    _dashboard: '═══\n  SPY OPTIONS DASHBOARD\n═══',
                  },
                },
              },
            },
          },
        }),
        list: () => [],
      },
      config: {
        market: { defaultLookbackDays: 180, quoteSummaryModules: [] },
        recursion: { maxDepth: 2 },
      },
    });

    const dashboard = handlers.get('yahoohoo_options_dashboard');
    const result = await dashboard({ runId: 'test-run', expiries: 5 });
    const text = result.content[0].text;
    assert.ok(text.includes('SPY OPTIONS DASHBOARD'));
  });

  it('returns error when run has no dashboard data', async () => {
    const { handlers, server } = makeToolRegistry();
    registerTools({
      server,
      marketData: {},
      analyzer: {},
      runStore: {
        get: () => ({
          analysis: {
            question: 'no options',
            symbols: ['AAPL'],
            metrics: { symbols: { AAPL: {} } },
          },
        }),
        list: () => [],
      },
      config: {
        market: { defaultLookbackDays: 180, quoteSummaryModules: [] },
        recursion: { maxDepth: 2 },
      },
    });

    const dashboard = handlers.get('yahoohoo_options_dashboard');
    const result = await dashboard({ runId: 'no-opts', symbol: 'AAPL', expiries: 5 });
    const text = result.content[0].text;
    assert.ok(text.includes('No dashboard'));
  });

  it('maps pairwise objects back to metrics.correlation_matrix', async () => {
    const { handlers, server } = makeToolRegistry();
    registerTools({
      server,
      marketData: {},
      analyzer: {},
      runStore: {
        get: () => ({
          analysis: {
            question: 'comparison study',
            symbols: ['QQQ', 'IWM'],
            metrics: {
              pairwise: {
                QQQ_vs_IWM: {
                  correlation: 0.645,
                  paired_observations: 26,
                },
              },
            },
          },
        }),
        list: () => [],
      },
      config: {
        market: { defaultLookbackDays: 180, quoteSummaryModules: [] },
        recursion: { maxDepth: 2 },
      },
    });

    const peek = handlers.get('yahoohoo_peek');
    const result = await peek({ runId: 'modern', path: 'metrics.correlation_matrix' });
    const text = result.content[0].text;

    assert.ok(text.includes('"QQQ_vs_IWM": 0.645'));
  });
});
