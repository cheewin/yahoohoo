#!/usr/bin/env python3
"""Practical sandbox runner for local market-analysis code.

This is intentionally restrictive but not a perfect security boundary. For strong
isolation, run Yahoohoo itself inside a container/VM.

Supports RLM-style llm_query(): sandbox code can call back to the host LLM
via a stdin/stdout JSON protocol with the Node parent process.
"""

from __future__ import annotations

import ast
import contextlib
import io
import json
import math
import pathlib
import statistics
import sys
import traceback
from collections import Counter, defaultdict, deque
from datetime import date, datetime, timedelta
from decimal import Decimal
from fractions import Fraction
from itertools import combinations, groupby, islice

try:
    import resource  # type: ignore
except Exception:  # pragma: no cover
    resource = None

DENIED_MODULE_PREFIXES = {
    "socket",
    "subprocess",
    "asyncio",
    "http",
    "urllib",
    "requests",
    "ftplib",
    "telnetlib",
    "webbrowser",
    "pathlib2",
    "ctypes",
    "multiprocessing",
    "concurrent",
    "shutil",
    "sqlite3",
    "dbm",
    "pickle",
    "marshal",
    "importlib",
    "runpy",
    "site",
}

DENIED_NAMES = {
    "eval",
    "exec",
    "compile",
    "input",
    "open",
    "__import__",
    "breakpoint",
    "help",
    "globals",
    "locals",
    "vars",
}

ALLOWED_MODULES = {
    "math": math,
    "statistics": statistics,
    "json": json,
}

SAFE_BUILTINS = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "filter": filter,
    "float": float,
    "int": int,
    "len": len,
    "list": list,
    "map": map,
    "max": max,
    "min": min,
    "pow": pow,
    "print": print,
    "range": range,
    "reversed": reversed,
    "round": round,
    "set": set,
    "slice": slice,
    "sorted": sorted,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
}


# ── RLM Protocol ──────────────────────────────────────────────────────
# When llm_query() is called from sandbox code, the runner writes a JSON
# request to FD 3 (a dedicated pipe) and reads the response from stdin.
# This avoids mixing llm_query protocol messages with the final result
# on stdout.
#
# Request (written to fd 3):  {"type":"llm_query","id":<int>,"prompt":<str>}
# Response (read from stdin): {"type":"llm_response","id":<int>,"text":<str>}
# Final result (stdout):      {"ok":true,"result":...}

_llm_query_counter = 0
_llm_pipe = None  # Set to fd 3 file object in main() if available
_llm_enabled = False
_llm_max_calls = 10  # prevent runaway recursion


def _llm_query(prompt: str) -> str:
    """Call back to the host LLM via the parent Node process."""
    global _llm_query_counter

    if not _llm_enabled:
        return "[llm_query unavailable: host does not support sampling]"

    if _llm_query_counter >= _llm_max_calls:
        return f"[llm_query limit reached: max {_llm_max_calls} calls per sandbox run]"

    _llm_query_counter += 1
    req = {"type": "llm_query", "id": _llm_query_counter, "prompt": prompt}

    try:
        _llm_pipe.write(json.dumps(req) + "\n")
        _llm_pipe.flush()

        # Read response from stdin (Node writes it there)
        line = sys.stdin.readline()
        if not line:
            return "[llm_query error: no response from host]"
        resp = json.loads(line)
        if resp.get("type") == "llm_response" and resp.get("id") == _llm_query_counter:
            return resp.get("text", "")
        return f"[llm_query error: unexpected response: {line[:200]}]"
    except Exception as e:
        return f"[llm_query error: {e}]"


def fail(message: str, *, detail: str | None = None, exit_code: int = 1) -> None:
    payload = {"ok": False, "error": message}
    if detail:
        payload["detail"] = detail
    sys.stdout.write(json.dumps(payload))
    raise SystemExit(exit_code)


def convert(obj):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, Fraction):
        return float(obj)
    if isinstance(obj, pathlib.Path):
        return str(obj)
    if isinstance(obj, set):
        return list(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def load_payload(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def apply_limits(settings: dict) -> None:
    if resource is None:
        return
    cpu_seconds = int(settings.get("cpu_seconds", 10))
    memory_mb = int(settings.get("memory_mb", 512))
    output_bytes = int(settings.get("max_output_bytes", 200_000))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
    memory_bytes = memory_mb * 1024 * 1024
    for limit_name in ["RLIMIT_AS", "RLIMIT_DATA"]:
        if hasattr(resource, limit_name):
            res = getattr(resource, limit_name)
            try:
                resource.setrlimit(res, (memory_bytes, memory_bytes))
            except Exception:
                pass
    if hasattr(resource, "RLIMIT_FSIZE"):
        try:
            resource.setrlimit(resource.RLIMIT_FSIZE, (output_bytes, output_bytes))
        except Exception:
            pass


def validate_tree(tree: ast.AST, settings: dict) -> None:
    allow_numpy = bool(settings.get("allow_numpy", True))
    allow_pandas = bool(settings.get("allow_pandas", True))

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            else:
                base = node.module or ""
                names = [base]
            for name in names:
                root = name.split(".")[0]
                if root == "numpy" and allow_numpy:
                    continue
                if root == "pandas" and allow_pandas:
                    continue
                if root not in ALLOWED_MODULES:
                    fail(f"Import of module '{name}' is not allowed in the Yahoohoo sandbox.")
                if any(root.startswith(prefix) for prefix in DENIED_MODULE_PREFIXES):
                    fail(f"Import of module '{name}' is blocked in the Yahoohoo sandbox.")
        if isinstance(node, ast.Name) and node.id in DENIED_NAMES:
            fail(f"Use of '{node.id}' is not allowed in the Yahoohoo sandbox.")
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            if node.value.id in {"os", "sys", "pathlib", "subprocess", "socket"}:
                fail(f"Attribute access on '{node.value.id}' is not allowed in the Yahoohoo sandbox.")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in DENIED_NAMES:
                fail(f"Call to '{node.func.id}' is not allowed in the Yahoohoo sandbox.")


def make_importer(settings: dict):
    allow_numpy = bool(settings.get("allow_numpy", True))
    allow_pandas = bool(settings.get("allow_pandas", True))

    def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
        root = name.split(".")[0]
        if root in ALLOWED_MODULES:
            return ALLOWED_MODULES[root]
        if root == "numpy" and allow_numpy:
            import numpy  # type: ignore
            return numpy
        if root == "pandas" and allow_pandas:
            import pandas  # type: ignore
            return pandas
        raise ImportError(f"Module '{name}' is not allowed in the Yahoohoo sandbox")

    return safe_import


def main() -> None:
    global _llm_pipe, _llm_enabled

    if len(sys.argv) != 2:
        fail("Usage: runner.py <payload.json>")

    payload = load_payload(sys.argv[1])
    code = payload.get("code", "")
    data = payload.get("input_data", {})
    settings = payload.get("settings", {})

    # Try to open fd 3 for llm_query protocol
    try:
        import os
        _llm_pipe = os.fdopen(3, "w", encoding="utf-8")
        _llm_enabled = True
        # Also reopen stdin for reading responses
        sys.stdin = io.TextIOWrapper(
            os.fdopen(0, "rb", 0), encoding="utf-8", newline="\n"
        )
    except Exception:
        _llm_enabled = False

    if not isinstance(code, str) or not code.strip():
        fail("Payload is missing executable Python code.")

    apply_limits(settings)

    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as error:
        fail("Sandbox code did not parse.", detail=str(error))

    validate_tree(tree, settings)

    globals_dict = {
        "__builtins__": dict(SAFE_BUILTINS, __import__=make_importer(settings)),
        "DATA": data,
        "Counter": Counter,
        "Decimal": Decimal,
        "Fraction": Fraction,
        "defaultdict": defaultdict,
        "deque": deque,
        "date": date,
        "datetime": datetime,
        "timedelta": timedelta,
        "groupby": groupby,
        "islice": islice,
        "combinations": combinations,
        "math": math,
        "statistics": statistics,
        "json": json,
        "RESULT": None,
        "llm_query": _llm_query,
    }

    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()

    try:
        compiled = compile(tree, filename="<sandbox>", mode="exec")
        with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
            exec(compiled, globals_dict, None)
    except BaseException as error:  # pragma: no cover - surfaced to caller
        fail(
            f"Sandbox execution failed: {error.__class__.__name__}: {error}",
            detail=traceback.format_exc(limit=12),
        )

    result = globals_dict.get("RESULT")
    payload = {
        "ok": True,
        "result": result,
        "stdout": stdout_buffer.getvalue()[: settings.get("max_output_bytes", 200_000)],
        "stderr": stderr_buffer.getvalue()[: settings.get("max_output_bytes", 200_000)],
        "llm_calls": _llm_query_counter,
    }
    sys.stdout.write(json.dumps(payload, default=convert))


if __name__ == "__main__":
    main()
