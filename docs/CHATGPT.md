# Register the private Yahoohoo endpoint in ChatGPT

First complete [Railway deployment](DEPLOYMENT.md) and verify HTTPS, authentication,
OAuth discovery, and provider requests. No local installation is required. ChatGPT
cannot connect to stdio or a loopback address on this cloud machine.

## ChatGPT Plugins (current documented interface)

1. Sign in to ChatGPT in your browser, in the intended account/workspace. Your
   account and workspace policies must permit adding custom MCP servers. If the
   controls are missing, ask the workspace administrator to enable custom MCP /
   developer access; this server cannot change your ChatGPT entitlement.
2. Open **ChatGPT Plugins**. Select **+ → Add custom MCP server**.
3. Enter name **Yahoohoo Private Finance** and description **Private Yahoo Finance
   and CoinGecko quotes, history, news, financial statements and comparisons**.
4. Under **Connection**, choose the public HTTPS endpoint method and enter the
   exact URL `https://YOUR-SERVICE.up.railway.app/mcp`, including `/mcp`.
5. Choose **OAuth**. Use **dynamic client registration (DCR)** when offered. This
   server advertises DCR, not CIMD; it creates a client ID/secret or public client
   through `/register`. Do not choose CIMD or paste the owner password into
   client-ID/client-secret fields. Discovery should populate the authorization
   and token URLs. If requested, use `market:read offline_access` for scopes.
6. Copy the exact callback URL shown in the MCP connection's management page to
   Railway's `YAHOOHOO_OAUTH_REDIRECT_URIS` and redeploy **before** completing the
   connection. This server advertises RFC 9207 issuer identification and returns
   `iss` on successful and error authorization redirects, so the documented
   stable callback is `https://chatgpt.com/connector_platform_oauth_redirect`.
   If ChatGPT displays a callback-specific URL such as
   `https://chatgpt.com/connector/oauth/{callback_id}`, allow that exact URL
   instead. Never wildcard callbacks. Changing this configuration restarts the
   server, so begin registration again afterward.
7. Review the risk notice and select **I understand and want to continue → Create
   as a plugin**. When prompted to connect, confirm the consent page is on your
   own Railway HTTPS domain, enter the owner password there, and authorize.
   ChatGPT receives a scoped OAuth token; the server never forwards the password.
8. Review the discovered tools. Expect **21 tools**, including `yahoo_news`,
   `yahoo_income_statement`, `yahoo_balance_sheet`, `yahoo_cash_flow`, existing
   Yahoo data/analysis tools, and all five CoinGecko tools. All advertise read-only
   behavior; analysis results are stored in memory within the session.
9. Install the resulting plugin. Open a new conversation, type **@**, and select
   it. Run the verification prompts below. Confirm actual tool results and errors;
   the existence of a plugin entry alone is not connection verification.

OAuth URLs are discovered at `/.well-known/oauth-protected-resource/mcp` and
`/.well-known/oauth-authorization-server`. They advertise the HTTPS `/mcp`
resource, `/authorize`, `/token`, `/register`, `/revoke`, S256 PKCE, and
`offline_access`. Redirect `iss` exactly matches the discovery issuer (including
its trailing slash). Tokens are restricted to this `/mcp` resource.

## Workspaces that still display Settings → Apps

Open **Settings → Apps → Advanced Settings** and enable developer mode if your
plan/workspace allows it. Admins may need **Workspace settings → Permissions &
Roles** to enable custom MCP access. Then choose **Apps → Create**, enter the same
HTTPS `/mcp` URL, choose OAuth/DCR, **Scan Tools**, complete owner consent, and
**Create**. The app appears as **Dev** or under **Drafts**. Keep it private to your
account; workspace-wide publication is not required for your personal workflow.
Labels and availability depend on the plan and rollout; follow the current UI
and official links below rather than the retired legacy plugin store workflow.

## Verify after registration

Use prompts such as:

- “Get AAPL, SPY, ^GSPC and BTC-USD quotes. Include market timestamps and exchange
  delays; distinguish unknown delay from zero delay.”
- “Compare AAPL and SPY OHLCV and returns over the last month.”
- “Get Apple's company news with publisher, publication time and article links.”
- “Fetch Apple's annual and quarterly income statement, balance sheet and cash
  flow. Preserve all line items; distinguish missing values from zero.”
- “Get SPY option chains and CoinGecko's top crypto markets.”

Check the selected tool, its arguments, timestamps, nonempty expected data and
provider errors. News relevance/coverage is provider-limited. A green `/health`
response is not proof that Yahoo or CoinGecko works. Do not assume statements
exist for ETFs, indices or crypto, or that delayed market data is real time.

## Reconnection and troubleshooting

This private deployment uses one process and in-memory OAuth state. Restarting,
redeploying or sleeping the instance invalidates clients and tokens: **recreate /
reconnect the plugin** so DCR runs again. An idle MCP session expires after 30
minutes; establish a new session when the server reports 404. Refresh tokens
rotate and expire after 7 days. For durable authorization across deployments,
replace the private provider with a managed identity provider and persistent state.

401 means authentication is missing/expired; check discovery and reconnect. 403
may mean an unapproved host/origin or wrong owner password. 429 includes
Retry-After for server throttling/busy analysis; Yahoo/CoinGecko can separately
rate-limit your hosting IP. If registration fails, confirm the exact callback
allowlist and OAuth audience, and ensure the HTTPS origin has no `/mcp` suffix in
`YAHOOHOO_PUBLIC_URL`. Refresh plugin metadata after changing tool definitions.

Official instructions checked 13 October 2026:

- [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Plugin authentication](https://developers.openai.com/plugins/build/auth)
- [Remote MCP servers](https://developers.openai.com/api/docs/mcp/)
- [Developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)

Deployment and ChatGPT connection are only successful after the external endpoint
and an authenticated ChatGPT tool call have been verified.
