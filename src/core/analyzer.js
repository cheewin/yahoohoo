import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildAnalysisPlan, computeConfidence, extractTickerCandidates, makeChildQuestions, renderDeterministicNarrative } from './heuristics.js';
import { classifyIntent } from './intents.js';
import { programForIntent } from './programs.js';
import { trySampling } from './sampling.js';
import { ValidationError, DataFetchError } from '../lib/errors.js';

function selectTimeframes(fromDate, toDate) {
  const days = Math.ceil((new Date(toDate) - new Date(fromDate)) / (86400_000));
  if (days <= 30) return null; // too short for multi-timeframe
  const frames = [{ interval: '1d', label: 'daily' }];
  if (days > 90) frames.push({ interval: '1wk', label: 'weekly' });
  if (days > 365) frames.push({ interval: '1mo', label: 'monthly' });
  return frames.length > 1 ? frames : null;
}

function mergeTimeframeResults(primary, extras) {
  if (!extras.length) return primary;
  const merged = { ...primary };
  merged.timeframes = {};
  for (const { label, result } of extras) {
    merged.timeframes[label] = result;
  }
  return merged;
}

function truncate(value, maxChars = 12_000) {
  const text = JSON.stringify(value, null, 2) ?? 'null';
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n... <truncated>`;
}

async function maybeLog(ctx, level, message, data) {
  if (!ctx?.mcpReq?.log) return;
  try {
    const suffix = data == null ? '' : `\n${truncate(data, 2000)}`;
    await ctx.mcpReq.log(level, `${message}${suffix}`);
  } catch {
    // Ignore host logging failures.
  }
}

async function emitProgress(ctx, { progress, total, message }) {
  if (!ctx?.mcpReq?.sendNotification) return;
  try {
    await ctx.mcpReq.sendNotification({
      method: 'notifications/progress',
      params: {
        progressToken: ctx._progressToken || 'yahoohoo_analyze',
        progress,
        total,
        message,
      },
    });
  } catch {
    // Ignore notification failures.
  }
}

export class RecursiveMarketAnalyzer {
  constructor({ config, logger, marketData, sandbox }) {
    this.config = config;
    this.logger = logger;
    this.marketData = marketData;
    this.sandbox = sandbox;
  }

  async analyze({
    query,
    symbols,
    benchmark,
    from,
    to,
    interval,
    reasoningMode,
    includeFundamentals,
    includeOptions,
    maxDepth,
    depth = 0,
    ctx,
  }) {
    const resolvedSymbols = await this.#resolveSymbols(query, symbols);
    if (!resolvedSymbols.length) {
      throw new ValidationError('Could not infer any symbols. Pass symbols explicitly or mention ticker-like names in the query.');
    }

    const mode = reasoningMode || this.config.recursion.defaultReasoningMode;
    const plan = buildAnalysisPlan({
      query,
      symbols: resolvedSymbols,
      benchmark,
      from,
      to,
      interval,
      config: this.config,
      includeFundamentals,
      includeOptions,
    });

    await maybeLog(ctx, 'info', `Yahoohoo analyzing ${resolvedSymbols.join(', ')} at depth ${depth} [intent=${plan.intent.primary}, program=${plan.program.name}].`, plan);

    // Progress: data fetch started
    const totalSteps = 4;
    await emitProgress(ctx, { progress: 0, total: totalSteps, message: `Fetching data for ${resolvedSymbols.join(', ')}…` });

    const quotes = await this.marketData.quote(plan.historySymbols);
    const history = Object.fromEntries(
      await Promise.all(
        plan.historySymbols.map(async (symbol) => [
          symbol,
          await this.marketData.historical(symbol, {
            from: plan.range.from,
            to: plan.range.to,
            interval: plan.interval,
          }),
        ]),
      ),
    );

    const summaries = plan.needsFundamentals
      ? Object.fromEntries(
          await Promise.all(
            resolvedSymbols.map(async (symbol) => [
              symbol,
              await this.marketData.quoteSummary(symbol, this.config.market.quoteSummaryModules),
            ]),
          ),
        )
      : {};

    const optionsPayload = plan.needsOptions
      ? Object.fromEntries(
          await Promise.all(
            resolvedSymbols.map(async (symbol) => {
              const primary = await this.marketData.options(symbol);
              // For options-focused queries, sweep multiple expiries
              if (plan.intent.primary === 'options' && Array.isArray(primary.expirationDates) && primary.expirationDates.length > 1) {
                const maxExpiries = this.config.market.optionsMaxExpiries || 5;
                const primaryDateStr = primary.activeExpirationDate ? String(primary.activeExpirationDate).slice(0, 10) : null;
                const startIdx = primaryDateStr ? primary.expirationDates.indexOf(primaryDateStr) + 1 : 1;
                const additionalDates = primary.expirationDates.slice(startIdx > 0 ? startIdx : 1, (startIdx > 0 ? startIdx : 1) + maxExpiries - 1);
                const chains = [{
                  expirationDate: primaryDateStr || primary.expirationDates[0],
                  calls: primary.calls,
                  puts: primary.puts,
                }];
                const extras = await Promise.all(
                  additionalDates.map(async (date) => {
                    try {
                      const chain = await this.marketData.options(symbol, date);
                      return { expirationDate: date, calls: chain.calls, puts: chain.puts };
                    } catch {
                      return null;
                    }
                  }),
                );
                for (const extra of extras) {
                  if (extra && (extra.calls.length || extra.puts.length)) chains.push(extra);
                }
                return [symbol, { ...primary, chains }];
              }
              return [symbol, primary];
            }),
          ),
        )
      : {};

    const sandboxInput = {
      query,
      symbols: resolvedSymbols,
      benchmark: plan.benchmark,
      quotes,
      history,
      summaries,
      options: optionsPayload,
    };

    // Progress: sandbox execution started
    await emitProgress(ctx, { progress: 1, total: totalSteps, message: `Running ${plan.program.name} sandbox program…` });

    // Build sampling callback for RLM-style llm_query() in sandbox.
    // Priority: MCP sampling > claude CLI > unavailable
    const samplingFn = ctx?.mcpReq?.requestSampling
      ? async (prompt) => {
          try {
            const response = await ctx.mcpReq.requestSampling({
              messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
              maxTokens: this.config.recursion.samplingMaxTokens,
              temperature: this.config.recursion.samplingTemperature,
            });
            const { flattenSamplingContent } = await import('./sampling.js');
            return flattenSamplingContent(response);
          } catch (err) {
            return `[sampling error: ${err.message}]`;
          }
        }
      : this.#makeLlmFallback();

    let sandboxResult;
    try {
      sandboxResult = await this.sandbox.run({
        code: plan.program.code,
        inputData: sandboxInput,
        metadata: {
          query,
          symbols: resolvedSymbols,
          depth,
          intent: plan.intent.primary,
          program: plan.program.name,
        },
        samplingFn,
      });
    } catch (error) {
      this.logger.warn(`Sandbox execution failed at depth ${depth}:`, error.message);
      sandboxResult = { ok: false, error: error.message };
    }

    if (!sandboxResult.ok) {
      this.logger.warn(`Sandbox returned error: ${sandboxResult.error}`);
      sandboxResult = { ok: true, result: { symbols: {}, benchmark: plan.benchmark, comparisons: {}, _sandboxError: sandboxResult.error } };
    }

    // Multi-timeframe: run additional intervals when no explicit interval was given at root
    if (depth === 0 && !interval && sandboxResult.ok) {
      const timeframes = selectTimeframes(plan.range.from, plan.range.to);
      if (timeframes) {
        const extras = [];
        for (const tf of timeframes) {
          if (tf.interval === plan.interval) continue; // skip primary
          try {
            const tfHistory = Object.fromEntries(
              await Promise.all(
                plan.historySymbols.map(async (s) => [
                  s,
                  await this.marketData.historical(s, { from: plan.range.from, to: plan.range.to, interval: tf.interval }),
                ]),
              ),
            );
            const tfInput = { ...sandboxInput, history: tfHistory };
            const tfResult = await this.sandbox.run({
              code: plan.program.code,
              inputData: tfInput,
              metadata: { query, symbols: resolvedSymbols, depth, intent: plan.intent.primary, program: plan.program.name, timeframe: tf.label },
              samplingFn,
            });
            if (tfResult.ok) extras.push({ label: tf.label, result: tfResult.result });
          } catch (err) {
            this.logger.debug(`Multi-timeframe ${tf.label} failed: ${err.message}`);
          }
        }
        if (extras.length) {
          sandboxResult.result = mergeTimeframeResults(sandboxResult.result, extras);
        }
      }
    }

    const node = {
      kind: 'analysis_node',
      question: query,
      symbols: resolvedSymbols,
      benchmark: plan.benchmark,
      range: plan.range,
      interval: plan.interval,
      depth,
      mode,
      intent: plan.intent,
      program: plan.program.name,
      quotes,
      metrics: sandboxResult.result,
      sampling: null,
      summary: null,
      reasoningNote: null,
      children: [],
    };

    const recursionBudget = typeof maxDepth === 'number' ? maxDepth : this.config.recursion.maxDepth;
    if (depth < recursionBudget && resolvedSymbols.length > 1) {
      let childSpecs = makeChildQuestions(query, resolvedSymbols, plan.benchmark, this.config.recursion.maxChildAnalyses);

      if (mode !== 'heuristic' && this.config.recursion.enableSampling) {
        const suggested = await this.#suggestChildrenWithSampling({
          ctx,
          question: query,
          symbols: resolvedSymbols,
          benchmark: plan.benchmark,
          range: plan.range,
        });
        if (suggested.length) {
          childSpecs = suggested.slice(0, this.config.recursion.maxChildAnalyses);
        }
      }

      for (let i = 0; i < childSpecs.length; i++) {
        const childSpec = childSpecs[i];

        // Classify each child's intent independently for program selection
        const childIntent = classifyIntent(childSpec.question, childSpec.symbols);
        const childProgram = programForIntent(childIntent.primary);

        // Progress: child analysis
        await emitProgress(ctx, { progress: 2, total: totalSteps, message: `Child analysis ${i + 1}/${childSpecs.length}: ${childSpec.symbols.join(', ')}` });
        await maybeLog(ctx, 'info', `Child ${i + 1}/${childSpecs.length}: intent=${childIntent.primary}, program=${childProgram.name}`);

        const child = await this.analyze({
          query: childSpec.question,
          symbols: childSpec.symbols,
          benchmark: childSpec.benchmark,
          from: plan.range.from,
          to: plan.range.to,
          interval: plan.interval,
          reasoningMode: mode,
          includeFundamentals,
          includeOptions,
          maxDepth: recursionBudget,
          depth: depth + 1,
          ctx,
        });
        node.children.push(child);
      }
    }

    // Progress: synthesis started
    await emitProgress(ctx, { progress: 3, total: totalSteps, message: 'Synthesizing results…' });

    const sampledSummary =
      mode !== 'heuristic' && this.config.recursion.enableSampling
        ? await this.#summarizeWithSampling({ ctx, node })
        : { ok: false, error: 'sampling_disabled' };

    if (sampledSummary.ok) {
      node.summary = sampledSummary.parsed.summary;
      node.reasoningNote = sampledSummary.parsed.reasoningNote || `Host model: ${sampledSummary.response.model || 'unknown'}`;
      node.sampling = {
        ok: true,
        model: sampledSummary.response.model || null,
      };
    } else {
      node.summary = renderDeterministicNarrative(node);
      node.reasoningNote = sampledSummary.error || 'Used deterministic summary because host sampling was unavailable.';
      node.sampling = {
        ok: false,
        error: sampledSummary.error,
      };
    }

    node.confidence = computeConfidence(node);
    return node;
  }

  // CLI specs: [command, ...args, null] where null is replaced with the prompt
  static LLM_CLIS = {
    claude:  { cmd: 'claude',   args: ['-p', null] },
    codex:   { cmd: 'codex',    args: ['exec', null] },
    gemini:  { cmd: 'gemini',   args: ['-p', null] },
    copilot: { cmd: 'copilot',  args: ['-p', '-s', null] },
  };

  #makeLlmFallback() {
    if (!this.config.sandbox.enableLlmQuery) return null;

    const preferred = this.config.sandbox.llmCli; // e.g. 'claude', 'gemini', etc.
    const exec = promisify(execFile);

    // If user specified a CLI, try only that one
    if (preferred && preferred !== 'auto') {
      const spec = RecursiveMarketAnalyzer.LLM_CLIS[preferred];
      if (!spec) {
        this.logger.warn(`Unknown llm CLI "${preferred}". Available: ${Object.keys(RecursiveMarketAnalyzer.LLM_CLIS).join(', ')}`);
        return null;
      }
      if (!this.#cliAvailable(spec.cmd)) {
        this.logger.warn(`${preferred} CLI not found, llm_query disabled`);
        return null;
      }
      this.logger.debug(`llm_query: using ${preferred} (on-device)`);
      return this.#wrapCli(spec, exec);
    }

    // Auto-detect: try each CLI in order
    for (const [name, spec] of Object.entries(RecursiveMarketAnalyzer.LLM_CLIS)) {
      if (this.#cliAvailable(spec.cmd)) {
        this.logger.debug(`llm_query: auto-detected ${name} (on-device)`);
        return this.#wrapCli(spec, exec);
      }
    }

    this.logger.debug('No LLM CLI found (tried claude, codex, gemini, copilot). llm_query disabled.');
    return null;
  }

  #cliAvailable(cmd) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'ignore', timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  #wrapCli(spec, exec) {
    return async (prompt) => {
      try {
        const args = spec.args.map((a) => a === null ? prompt : a);
        const { stdout } = await exec(spec.cmd, args, {
          timeout: 60_000,
          maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, NO_COLOR: '1' },
        });
        return stdout.trim();
      } catch (err) {
        return `[${spec.cmd} error: ${err.message}]`;
      }
    };
  }

  async #resolveSymbols(query, providedSymbols = []) {
    const explicit = [...new Set((providedSymbols || []).map((symbol) => symbol.toUpperCase()))].filter(Boolean);
    if (explicit.length) return explicit;

    const fromText = extractTickerCandidates(query);
    if (fromText.length) return fromText;

    const searchResults = await this.marketData.search(query, 5);
    return searchResults
      .map((item) => item.symbol)
      .filter(Boolean)
      .slice(0, 3);
  }

  async #suggestChildrenWithSampling({ ctx, question, symbols, benchmark, range }) {
    const sampling = await trySampling(ctx, {
      systemPrompt: `You are Yahoohoo, a recursive market-analysis planner. Return JSON only. Decide whether decomposing the request into symbol-specific subquestions would improve analysis. JSON schema: {"children":[{"question":"...","symbols":["AAPL"],"benchmark":"SPY"}]}. Prefer at most 3 children.`,
      userPrompt: `Question: ${question}\nSymbols: ${symbols.join(', ')}\nBenchmark: ${benchmark || 'none'}\nRange: ${range.from} to ${range.to}`,
      maxTokens: 500,
      temperature: this.config.recursion.samplingTemperature,
    });

    if (!sampling.ok) return [];
    return Array.isArray(sampling.parsed?.children)
      ? sampling.parsed.children.filter((child) => Array.isArray(child.symbols) && child.symbols.length)
      : [];
  }

  async #summarizeWithSampling({ ctx, node }) {
    return trySampling(ctx, {
      systemPrompt: `You are Yahoohoo, a recursive market analyst. Return JSON only with this exact shape: {"summary":"<final narrative>","reasoningNote":"<one short note on how the answer was produced>"}. Be precise. Use only the metrics supplied. Mention uncertainty if data coverage is thin.`,
      userPrompt: `Question: ${node.question}\nSymbols: ${node.symbols.join(', ')}\nBenchmark: ${node.benchmark || 'none'}\nRange: ${node.range.from} to ${node.range.to}\nCrossSection: ${truncate(node.metrics?.cross_section, 4_000)}\nBenchmarkComparisons: ${truncate(node.metrics?.comparisons, 4_000)}\nMetrics: ${truncate(node.metrics, 11_000)}\nChildSummaries: ${truncate(node.children.map((child) => ({ symbols: child.symbols, summary: child.summary })), 6_000)}`,
      maxTokens: this.config.recursion.samplingMaxTokens,
      temperature: this.config.recursion.samplingTemperature,
    });
  }
}
