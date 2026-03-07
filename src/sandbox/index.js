import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { stableStringify } from '../lib/json.js';
import { startTimer } from '../lib/logger.js';
import { SandboxError, SandboxTimeoutError } from '../lib/errors.js';

export class PythonSandbox {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.runnerPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'runner.py');
  }

  async run({ code, inputData, metadata = {} }) {
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
      const result = await this.#spawn(payloadPath, tempDir);
      const ms = timer.elapsedMs();
      this.logger.debug(`Sandbox completed in ${ms.toFixed(0)}ms`, metadata);
      result._timing = { sandboxMs: Math.round(ms) };
      return result;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  #spawn(payloadPath, cwd) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.sandbox.pythonCommand, [this.runnerPath, payloadPath], {
        cwd,
        env: {
          PYTHONIOENCODING: 'utf-8',
          PYTHONNOUSERSITE: '1',
          PYTHONPATH: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
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
