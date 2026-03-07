# Security notes

Yahoohoo intentionally avoids pretending that a subprocess-based Python runner is a perfect sandbox.

## Threat model

### What Yahoohoo trusts

- **The MCP host** is trusted. It supplies the reasoning layer and can invoke any tool. Yahoohoo does not authenticate or rate-limit the host connection itself.
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
- There is no built-in authentication. Use a reverse proxy or network-level controls for access management.
- A `/health` endpoint is available for readiness probes but does not expose sensitive information.
