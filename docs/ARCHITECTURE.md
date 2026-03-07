# Architecture

## Core principle

Yahoohoo separates three concerns:

1. **Market-data access**
2. **Recursive reasoning orchestration**
3. **Numerical execution**

The point is to keep the server portable across MCP hosts.

## Layer 1: data plane

`src/adapters/yahoo.js`

This layer wraps `yahoo-finance2` and normalizes:

- search results
- quotes
- historical bars
- quote summary modules
- option chains

It also adds a short TTL cache to avoid needless repeated calls during recursive analysis.

## Layer 2: recursive orchestrator

`src/core/analyzer.js`

This layer decides:

- which symbols to analyze
- whether a benchmark is needed
- whether fundamentals / options should be fetched
- whether to split a problem into child analyses

When the host supports MCP sampling, the orchestrator can ask the host model to:

- propose better child questions
- synthesize recursive outputs into a final answer

When sampling is not available, the orchestrator falls back to heuristic decomposition.

## Layer 3: execution plane

`src/sandbox/runner.py`

All quantitative work runs in the sandbox. Right now the server ships a general market-metrics Python program that computes:

- total return
- realized volatility
- max drawdown
- moving-average context
- beta / correlation versus benchmark
- compact fundamentals summary
- compact options summary

This is the most Aleph-like part of the design:

- orchestration can stay language-model-driven
- numerical work stays code-driven and auditable
- the code path is isolated from the host process

## Transport strategy

`src/index.js`

Yahoohoo supports two entry modes:

- `stdio` for local MCP clients
- `http` for remote Streamable HTTP MCP clients

That lets the same codebase serve:

- local coding agents
- desktop assistants
- remote connectors like ChatGPT-style integrations
