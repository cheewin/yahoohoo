# Using Yahoohoo with ChatGPT

ChatGPT works best with Yahoohoo over **remote Streamable HTTP**.

## Setup

### 1. Start Yahoohoo in HTTP mode

```bash
node src/index.js --transport http
```

By default this listens on `http://127.0.0.1:3434/mcp`.

Or run the included container image:

```bash
docker build -t yahoohoo .
docker run --rm \
  -p 3434:3434 \
  -e YAHOOHOO_ALLOWED_HOSTS=your-domain.com \
  yahoohoo
```

### 2. Expose over HTTPS

ChatGPT requires HTTPS. Options:

- **Tunnel** (fastest for local dev): Use `cloudflared`, `ngrok`, or similar to expose port 3434 over HTTPS.
- **Reverse proxy**: Put Yahoohoo behind nginx/Caddy with a TLS certificate.
- **Cloud deploy**: Deploy to a VPS/container service with HTTPS termination.

Example with cloudflared:

```bash
cloudflared tunnel --url http://localhost:3434
```

### 3. Configure ChatGPT

Point the ChatGPT MCP connector at `https://YOUR-ENDPOINT/mcp`.

## Health check

Verify the server is running:

```bash
curl http://localhost:3434/health
```

Returns:

```json
{"status":"ok","server":"yahoohoo","version":"0.1.0","sessions":0}
```

## Environment variables

For production deployment, consider setting:

```bash
YAHOOHOO_HOST=0.0.0.0                    # bind to all interfaces
YAHOOHOO_ALLOWED_HOSTS=your-domain.com    # restrict Host header
YAHOOHOO_LOG_LEVEL=info                   # or debug for troubleshooting
```

## What works and what doesn't

| Feature | Status |
|---------|--------|
| Direct tools (yahoo_search, yahoo_quote, etc.) | Works |
| yahoohoo_analyze (heuristic mode) | Works |
| yahoohoo_analyze (sampling mode) | Depends on whether the ChatGPT connector supports MCP sampling |
| Recursive child analyses | Works (heuristic fallback when sampling unavailable) |

## Notes

- Yahoohoo does not require its own model API key. It uses MCP sampling when the connected client offers it.
- If sampling is unavailable, Yahoohoo still returns deterministic analysis results.
- Multi-symbol studies now include a ranked comparison snapshot before per-symbol detail.
- The `/health` endpoint is available for monitoring but is not an MCP endpoint.
