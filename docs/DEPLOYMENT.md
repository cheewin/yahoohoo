# Private deployment on Railway

You need a Railway account with billing enabled, GitHub access to
`cheewin/yahoohoo`, and a ChatGPT account/workspace that permits custom MCP plugins.
You do **not** need Node, Python, Docker, or the Railway CLI on your computer.

## Deploy through the browser

1. Review/merge the PR on GitHub (or select its feature branch for testing).
2. Sign in at https://railway.com. Choose **New Project → Deploy from GitHub repo**,
   authorize Railway's GitHub app for this repository, and select `cheewin/yahoohoo`.
   Use repository root `/`; the root `railway.toml` selects the Dockerfile and
   `/health` check. If Railway starts before secrets are configured, startup will
   intentionally fail closed; set variables before redeploying.
3. Create **one** service/replica in one region. Give it at least **1 GB RAM**;
   disable serverless/sleep. No database or volume is required. Restrict Railway
   project membership to yourself. Set a spending alert/limit in billing.
4. In service **Settings → Networking → Public Networking**, generate a Railway
   domain. Target port `3434` with the variables below. Railway terminates HTTPS.
   A public route is necessary for ChatGPT, but `/mcp` always requires auth.
5. In service **Variables**, set these values. Store secrets as sealed variables
   where supported; never paste them into GitHub, logs, chat, or source files.

| Variable | Value |
| --- | --- |
| `YAHOOHOO_TRANSPORT` | `http` |
| `YAHOOHOO_HOST` | `0.0.0.0` |
| `YAHOOHOO_PORT` | `3434` |
| `YAHOOHOO_PUBLIC_URL` | `https://YOUR-SERVICE.up.railway.app` (origin only) |
| `YAHOOHOO_ALLOWED_HOSTS` | `YOUR-SERVICE.up.railway.app,localhost,127.0.0.1` |
| `YAHOOHOO_OWNER_PASSWORD` | A unique password-manager-generated secret, at least 32 characters |
| `YAHOOHOO_OAUTH_REDIRECT_URIS` | `https://chatgpt.com/connector_platform_oauth_redirect` (or exact callback displayed in plugin management) |
| `YAHOOHOO_RATE_LIMIT` | `60` |
| `YAHOOHOO_MAX_SESSIONS` | `20` |
| `YAHOOHOO_SESSION_TTL_MS` | `1800000` |
| `YAHOOHOO_ENABLE_SAMPLING` | `false` |
| `YAHOOHOO_LLM_QUERY` | `false` |
| `YAHOOHOO_MAX_DEPTH` | `1` |
| `YAHOOHOO_SANDBOX_MEMORY_MB` | `512` |
| `COINGECKO_API_KEY` | Optional CoinGecko **demo** key, stored securely |
| `YAHOOHOO_API_KEYS` | Optional independent random admin bearer key(s) for automated smoke checks; not the owner password |

Do not select “no authentication” in ChatGPT or use a query-string key. The owner
password is entered only on Yahoohoo's HTTPS consent page. ChatGPT receives an
OAuth access token, not that password. The API-key option is for MCP clients that
support Authorization headers; it is not needed for ChatGPT's OAuth flow.

6. Apply variables and redeploy. Confirm deployment logs report authenticated
   HTTP startup, and Railway's `/health` check passes.
7. Verify the **deployed HTTPS** URL before registering it:
   - `GET /health` returns `status: ok` and minimal server metadata.
   - `POST /mcp` without Authorization returns **401**, with a discovery challenge.
   - `GET /.well-known/oauth-protected-resource/mcp` names the exact HTTPS `/mcp`
     resource and issuer.
   - `GET /.well-known/oauth-authorization-server` advertises S256, DCR,
     `offline_access`, and issuer identification.
   - Complete the OAuth tool scan and an actual quote/history request in ChatGPT.
   A green health check alone does not prove finance providers or ChatGPT work.

For an automated authenticated check in this cloud workspace, supply the bearer
token securely in `YAHOOHOO_SMOKE_TOKEN` and set `YAHOOHOO_SMOKE_URL` to the deployed
HTTPS `/mcp` URL, then run `npm run smoke:http`. Do not put a token in the command
line. The script checks unauthenticated rejection, MCP initialization, tool
listing, quotes for four asset classes, history, news, three statements, options,
CoinGecko and multi-ticker analysis, then terminates its session. It exits nonzero
on failures. Logs never print auth values.

## Account authorization for agent-assisted deployment

An agent cannot deploy under your account until it is authorized. This cloud
workspace has a checksum-verified Railway CLI at `/workspace/railway-bin/railway`.
Run its `login --browserless` flow here and open the emitted Railway device login
link in your browser; approve only your intended account. The flow may expire.
Do not send a Railway token in chat. Alternatively authorize deployment via the
Railway dashboard above. A project/workspace selection is needed after login.
Billing changes must be made by the account owner; no paid plan is selected by
this repository.

## Expected cost

Railway's published container rates checked on **13 October 2026**: Hobby is
**$5/month minimum**, including $5 resource usage; RAM **$10/GB-month**, CPU
**$20/vCPU-month**, outbound transfer **$0.05/GB**. Usage above the included $5 is
charged as the difference, not an additional flat $5. Example: 0.25 GB average RAM
($2.50), 0.05 vCPU average ($1), and 1 GB transfer ($0.05) stays within the $5
minimum. 0.5 GB RAM and 0.1 vCPU average is about $7 plus transfer. Budget roughly
**$5–15/month** for light personal use; bursts and sustained analysis can cost
more. A 1 GB memory limit is not the same as 1 GB of continuous memory use.
Verify the current [Railway pricing](https://docs.railway.com/reference/pricing/plans)
before deploying. No actual hosting bill is known until a deployment is measured.
Yahoo access is unofficial and unpriced here; CoinGecko's paid plans, a custom
domain, and your ChatGPT subscription are separate. No model API billing is
required by the deterministic server.

## Fly.io alternative

Run from repository root using `deploy/fly.toml`. Replace its app name and add
your HTTPS public origin and host allowlist. Store the owner password and optional
keys with Fly Secrets, not in TOML. Set one 1 GB machine, keep it awake, retain
`force_https=true`, and deploy with the root Dockerfile. Authenticate to Fly and
confirm billing first. Fly pricing varies by region and VM; check
https://fly.io/docs/about/pricing/ rather than assuming a free tier. Verify the
same health, auth, OAuth, finance and ChatGPT checks. Do not scale replicas with
the in-memory OAuth implementation.

## Operational limits

Access tokens expire after 1 hour; refresh tokens after 7 days and rotate on use.
**Restart or redeploy invalidates all OAuth registrations/tokens and sessions**.
Recreate/reconnect the plugin after restart; do not treat this implementation as a
durable multi-user identity service. Idle MCP sessions expire after 30 minutes.
Only one analysis runs at a time; busy calls return 429 with Retry-After. HTTP
rate limits are per key/OAuth client plus a shared 120/min direct-peer perimeter.
The hosting proxy's IP may be shared. Cache TTL defaults to 30 seconds; timestamps
are original provider fetch times. Yahoo/CoinGecko may throttle even when local
limits permit a request. No deployment/connection success is established until
the external endpoint and a ChatGPT call have actually been verified.
