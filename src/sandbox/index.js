import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stableStringify } from '../lib/json.js';
import { startTimer } from '../lib/logger.js';
import { SandboxError, SandboxTimeoutError } from '../lib/errors.js';

export class PythonSandbox {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.runnerPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'runner.py');
  }

  async run({ code, inputData, metadata = {}, samplingFn }) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yahoohoo-'));
    const payloadPath = path.join(tempDir, 'payload.json');
    const payload = {
      code,
      input_data: inputData,
      settings: {
        cpu_seconds: this.config.sandbox.cpuSeconds,
        memory_mb: this.config.sandbox.memoryMb,
        max_output_bytes: this.config.sandbox.maxOutputBytes,
        allow_numpy: this.config.sandbox.allowNumpy,
        allow_pandas: this.config.sandbox.allowPandas,
        strict_file_isolation: this.config.sandbox.strictFileIsolation,
      },
      metadata,
    };

    await fs.writeFile(payloadPath, stableStringify(payload));

    try {
      const timer = startTimer();
      const result = await this.#spawn(payloadPath, tempDir, samplingFn);
      const ms = timer.elapsedMs();
      this.logger.debug(`Sandbox completed in ${ms.toFixed(0)}ms`, metadata);
      result._timing = { sandboxMs: Math.round(ms) };
      return result;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  #spawn(payloadPath, cwd, samplingFn) {
    return new Promise((resolve, reject) => {
      // Create child with fd 3 as a pipe for llm_query requests
      const child = spawn(this.config.sandbox.pythonCommand, [this.runnerPath, payloadPath], {
        cwd,
        env: {
          PYTHONIOENCODING: 'utf-8',
          PYTHONNOUSERSITE: '1',
          PYTHONPATH: '',
        },
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'], // stdin, stdout, stderr, fd3 (llm_query pipe)
      });

      let stdout = '';
      let stderr = '';
      let completed = false;

      const timer = setTimeout(() => {
        if (completed) return;
        completed = true;
        child.kill('SIGKILL');
        reject(new SandboxTimeoutError(this.config.sandbox.timeoutMs));
      }, this.config.sandbox.timeoutMs);

      child.stdout.setEncoding('utf-8');
      child.stderr.setEncoding('utf-8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });

      // Handle llm_query requests from Python via fd 3
      if (child.stdio[3]) {
        const fd3 = child.stdio[3];
        fd3.setEncoding('utf-8');
        let fd3Buffer = '';
        fd3.on('data', async (chunk) => {
          fd3Buffer += chunk;
          // Process complete lines
          let newlineIdx;
          while ((newlineIdx = fd3Buffer.indexOf('\n')) !== -1) {
            const line = fd3Buffer.slice(0, newlineIdx);
            fd3Buffer = fd3Buffer.slice(newlineIdx + 1);
            if (!line.trim()) continue;
            try {
              const req = JSON.parse(line);
              if (req.type === 'llm_query' && samplingFn) {
                const responseText = await samplingFn(req.prompt);
                const resp = JSON.stringify({ type: 'llm_response', id: req.id, text: responseText }) + '\n';
                child.stdin.write(resp);
              } else {
                // No sampling available — return error
                const resp = JSON.stringify({ type: 'llm_response', id: req.id, text: '[llm_query unavailable: no sampling function provided]' }) + '\n';
                child.stdin.write(resp);
              }
            } catch (err) {
              this.logger.warn('llm_query protocol error:', err.message);
              try {
                const resp = JSON.stringify({ type: 'llm_response', id: 0, text: `[llm_query error: ${err.message}]` }) + '\n';
                child.stdin.write(resp);
              } catch {
                // stdin may be closed
              }
            }
          }
        });
      }

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (completed) return;
        completed = true;

        if (code !== 0) {
          return reject(new SandboxError(`Sandbox process failed with code ${code}: ${stderr || stdout}`));
        }

        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed);
        } catch (error) {
          reject(new SandboxError(`Sandbox returned invalid JSON.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}\n${error}`));
        }
      });
    });
  }
}
