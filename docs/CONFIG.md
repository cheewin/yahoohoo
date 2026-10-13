# Configuration

All configuration is via environment variables. No config files.

| Variable | Default | Description |
|----------|---------|-------------|
| `YAHOOHOO_TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `YAHOOHOO_HOST` | `127.0.0.1` | HTTP bind address |
| `YAHOOHOO_PORT` | `PORT` or `3434` | HTTP port |
| `YAHOOHOO_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Host header allow-list |
| `YAHOOHOO_API_KEYS` | *(none)* | Comma-separated API keys for HTTP auth |
| `YAHOOHOO_PUBLIC_URL` | *(none)* | HTTPS origin for OAuth and discovery |
| `YAHOOHOO_OWNER_PASSWORD` | *(none)* | Owner consent secret, at least 32 random characters |
| `YAHOOHOO_OAUTH_REDIRECT_URIS` | ChatGPT stable callback | Exact callback allowlist; see ChatGPT guide |
| `YAHOOHOO_SESSION_TTL_MS` | `1800000` | Idle session lifetime |
| `YAHOOHOO_RATE_LIMIT` | `60` | Max requests per minute per authenticated principal |
| `YAHOOHOO_MAX_SESSIONS` | `50` | Max concurrent MCP sessions |
| `YAHOOHOO_DATA_PROVIDER` | `yahoo` | Market data provider |
| `COINGECKO_API_KEY` | *(none)* | CoinGecko demo API key (optional, increases rate limit) |
| `YAHOOHOO_CACHE_TTL_MS` | `30000` | Market data cache TTL |
| `YAHOOHOO_DEFAULT_LOOKBACK_DAYS` | `180` | Default historical window |
| `YAHOOHOO_DEFAULT_BENCHMARK` | `SPY` | Default benchmark symbol |
| `YAHOOHOO_OPTIONS_MAX_EXPIRIES` | `5` | Max expiries to sweep |
| `YAHOOHOO_REASONING_MODE` | `auto` | Default: `auto`, `sampling`, `heuristic` |
| `YAHOOHOO_MAX_DEPTH` | `2` | Max recursion depth |
| `YAHOOHOO_MAX_CHILDREN` | `3` | Max child analyses per level |
| `YAHOOHOO_ENABLE_SAMPLING` | `true` | Enable MCP sampling requests |
| `YAHOOHOO_PYTHON` | `python3` | Python command for sandbox |
| `YAHOOHOO_SANDBOX_TIMEOUT_MS` | `20000` | Sandbox execution timeout |
| `YAHOOHOO_SANDBOX_CPU_SECONDS` | `10` | Max CPU seconds |
| `YAHOOHOO_SANDBOX_MEMORY_MB` | `512` | Max memory for sandbox |
| `YAHOOHOO_LLM_QUERY` | `true` | Enable `llm_query()` in sandbox via CLI fallback |
| `YAHOOHOO_LLM_CLI` | `auto` | Which CLI for `llm_query()`: `auto`, `claude`, `codex`, `gemini`, `copilot` |
| `YAHOOHOO_DRAIN_TIMEOUT_MS` | `10000` | Graceful shutdown drain timeout |
| `YAHOOHOO_MAX_SAVED_RUNS` | `100` | Max saved analysis runs |
| `YAHOOHOO_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

## HTTP Mode

- **Streamable HTTP** at `POST /mcp` (initialize), `GET /mcp` (SSE), `DELETE /mcp` (close)
- **Health endpoint** at `GET /health`
- **OAuth** with DCR, S256 PKCE, owner consent, resource audience and issuer identification; ChatGPT-compatible. HTTP startup refuses missing authentication.
- **API key auth** via `Authorization: Bearer <key>` when `YAHOOHOO_API_KEYS` is set
- **Rate limiting** with `X-RateLimit-*` headers
- **Session tracking** via `mcp-session-id` header
- **Request IDs** via `X-Request-Id` header

## Deployment

```bash
# Docker Compose
docker compose up -d

# Fly.io
fly launch --config deploy/fly.toml
fly deploy --config deploy/fly.toml

# Railway — import repository root; railway.toml selects Dockerfile and /health
```

See [deployment](DEPLOYMENT.md) for required secrets/hosts, HTTPS checks, single-replica limitations and costs. Docker remote defaults disable sampling and CLI LLM calls.
