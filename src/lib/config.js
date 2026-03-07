import os from 'node:os';

function envInt(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function envList(name, fallback = []) {
  const value = process.env[name];
  if (!value) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(overrides = {}) {
  const transport = overrides.transport || process.env.YAHOOHOO_TRANSPORT || 'stdio';
  const host = process.env.YAHOOHOO_HOST || '127.0.0.1';
  const port = envInt('YAHOOHOO_PORT', 3434);

  return {
    server: {
      name: 'yahoohoo',
      version: '0.2.0',
      transport,
      host,
      port,
      allowedHosts: envList('YAHOOHOO_ALLOWED_HOSTS', ['localhost', '127.0.0.1']),
    },
    market: {
      dataProvider: process.env.YAHOOHOO_DATA_PROVIDER || 'yahoo',
      cacheTtlMs: envInt('YAHOOHOO_CACHE_TTL_MS', 30_000),
      defaultLookbackDays: envInt('YAHOOHOO_DEFAULT_LOOKBACK_DAYS', 180),
      defaultBenchmark: process.env.YAHOOHOO_DEFAULT_BENCHMARK || 'SPY',
      optionsMaxExpiries: envInt('YAHOOHOO_OPTIONS_MAX_EXPIRIES', 5),
      quoteSummaryModules: envList('YAHOOHOO_DEFAULT_SUMMARY_MODULES', [
        'price',
        'summaryDetail',
        'financialData',
        'defaultKeyStatistics',
        'calendarEvents',
        'assetProfile',
      ]),
    },
    recursion: {
      defaultReasoningMode: process.env.YAHOOHOO_REASONING_MODE || 'auto',
      maxDepth: envInt('YAHOOHOO_MAX_DEPTH', 2),
      maxChildAnalyses: envInt('YAHOOHOO_MAX_CHILDREN', 3),
      samplingMaxTokens: envInt('YAHOOHOO_SAMPLING_MAX_TOKENS', 900),
      samplingTemperature: Number.parseFloat(process.env.YAHOOHOO_SAMPLING_TEMPERATURE || '0.2'),
      enableSampling: envBool('YAHOOHOO_ENABLE_SAMPLING', true),
    },
    sandbox: {
      pythonCommand: process.env.YAHOOHOO_PYTHON || (os.platform() === 'win32' ? 'python' : 'python3'),
      timeoutMs: envInt('YAHOOHOO_SANDBOX_TIMEOUT_MS', 20_000),
      cpuSeconds: envInt('YAHOOHOO_SANDBOX_CPU_SECONDS', 10),
      memoryMb: envInt('YAHOOHOO_SANDBOX_MEMORY_MB', 512),
      maxOutputBytes: envInt('YAHOOHOO_SANDBOX_OUTPUT_BYTES', 200_000),
      allowNumpy: envBool('YAHOOHOO_SANDBOX_ALLOW_NUMPY', true),
      allowPandas: envBool('YAHOOHOO_SANDBOX_ALLOW_PANDAS', true),
      strictFileIsolation: envBool('YAHOOHOO_SANDBOX_STRICT_FILES', false),
      enableLlmQuery: envBool('YAHOOHOO_LLM_QUERY', true),
      llmCli: process.env.YAHOOHOO_LLM_CLI || 'auto',
    },
    auth: {
      apiKeys: envList('YAHOOHOO_API_KEYS', []),
      rateLimitPerMinute: envInt('YAHOOHOO_RATE_LIMIT', 60),
    },
    shutdown: {
      drainTimeoutMs: envInt('YAHOOHOO_DRAIN_TIMEOUT_MS', 10_000),
    },
    sessions: {
      maxSessions: envInt('YAHOOHOO_MAX_SESSIONS', 50),
    },
    crypto: {
      apiKey: process.env.COINGECKO_API_KEY || null,
    },
    storage: {
      maxSavedRuns: envInt('YAHOOHOO_MAX_SAVED_RUNS', 100),
    },
    logging: {
      level: process.env.YAHOOHOO_LOG_LEVEL || 'info',
    },
  };
}
