# Security notes

Yahoohoo intentionally avoids pretending that a subprocess-based Python runner is a perfect sandbox.

## Threat model

### What Yahoohoo trusts

- **The MCP host** is trusted. It supplies the reasoning layer and can invoke any tool. Stdio trusts the local host. Remote HTTP requires OAuth or configured bearer keys and enforces rate limits; it never starts unauthenticated.
- **yahoo-finance2** is trusted as a dependency. It makes network calls to Yahoo Finance on behalf of the Node process.
- **The local Python runtime** is trusted. The sandbox restricts what user-generated code can do, but it runs inside the same Python interpreter.

### What Yahoohoo restricts

The sandbox restricts **generated analysis code** (the code that runs inside `runner.py`):

| Control | Implementation |
|---------|---------------|
| **Import blocking** | AST-level validation denies network, process, filesystem, serialization, and dynamic-loading modules. A runtime import hook enforces the same list. |
| **Builtin restriction** | `eval`, `exec`, `compile`, `open`, `input`, `__import__`, `breakpoint`, `globals`, `locals`, `vars` are removed from the sandbox namespace. |
| **Attribute blocking** | Access to `os.*`, `sys.*`, `pathlib.*`, `subprocess.*`, `socket.*` attributes is blocked at the AST level. |
| **Resource limits** | CPU time, memory (via `RLIMIT_AS`/`RLIMIT_DATA`), and output file size are capped via Python's `resource` module where available (Linux/macOS). |
| **Execution timeout** | The Node process kills the sandbox subprocess after `YAHOOHOO_SANDBOX_TIMEOUT_MS` (default 20s). |
| **Working directory** | Code runs in a temporary directory that is deleted after execution. |
| **Environment** | The subprocess inherits a minimal environment (`PYTHONIOENCODING`, `PYTHONNOUSERSITE`, empty `PYTHONPATH`). |
| **Output channel** | Results pass through stdout as JSON only. Output is size-limited. |

### What this does NOT protect against

- **Python runtime escapes**: A determined attacker who can supply arbitrary Python code may find ways to escape AST-level restrictions (e.g., through `type.__subclasses__()`, frame inspection, or CPython internals). The sandbox is defense-in-depth, not a security boundary.
- **Side-channel attacks**: CPU timing, memory patterns, and filesystem metadata are not isolated.
- **Resource exhaustion on Windows**: The `resource` module is not available; CPU/memory limits are not enforced. Only the Node-level timeout applies.
- **Network access from the Node process**: The Node process itself makes network calls (to Yahoo Finance). Only the sandboxed Python code is network-restricted.

### What this is NOT equivalent to

- A hardened container boundary (Docker with seccomp/AppArmor)
- A VM (Firecracker, gVisor)
- A process jail (nsjail, firejail, bubblewrap)
- seccomp, AppArmor, or SELinux profiles

## Recommended deployment

For serious or multi-tenant use:

1. Run Yahoohoo inside a container or dev container.
   The repository includes a `Dockerfile` for a baseline Node 22 + Python 3 deployment.
2. Mount only the minimum directories needed.
3. Keep the HTTP endpoint behind a private network or authenticated reverse proxy.
4. Set `YAHOOHOO_HOST=127.0.0.1` (default) to avoid binding to all interfaces.
5. Configure `YAHOOHOO_ALLOWED_HOSTS` when binding to `0.0.0.0`.
6. Disable sampling (`YAHOOHOO_ENABLE_SAMPLING=false`) for purely deterministic behavior.
7. Consider replacing the built-in runner with a stronger backend (Docker, nsjail) for untrusted code.

## HTTP transport security

- The HTTP endpoint includes a host-header guard that rejects requests with unrecognized `Host` headers when listening on `0.0.0.0` or `::`.
- HTTP fails closed unless OAuth or API keys are configured. OAuth uses owner consent, PKCE, issuer identification, resource-scoped access tokens, and rotating refresh tokens. API keys require an Authorization Bearer header on every MCP method.
- A `/health` endpoint is public for probes and exposes only server name, version, and status. Sessions and run contents are private. OAuth metadata, registration and the password-protected consent flow must be publicly reachable for ChatGPT authentication.

## Private remote deployment

See [audit findings](AUDIT.md) and [Railway deployment](DEPLOYMENT.md). Each MCP
session belongs to one authenticated principal. Sessions idle out after 30 minutes,
and only one analyze/drill request executes at a time. Secrets are supplied by
hosting environment variables; never store them in the image, repository, URL
query strings, or logs. OAuth state is bounded and in memory; restart invalidates
registrations/tokens and requires reconnecting ChatGPT. Do not scale replicas or
enable automatic sleep. For durable authorization, use a managed identity provider.

Forwarded IPs are intentionally ignored, preventing client-spoofed rate-limit
identities. The direct-peer perimeter budget can be shared by hosting-proxy users.
The default remote image disables sampling and LLM CLI calls. Treat all news and
provider content as untrusted input. Rotate the owner password/admin keys in hosting
settings and redeploy to revoke sessions. No unauthenticated market-data endpoint
is provided; `/health` and OAuth discovery are the only public operational data.
