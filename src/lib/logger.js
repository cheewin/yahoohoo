import { randomUUID } from 'node:crypto';

const LEVELS = ['debug', 'info', 'warn', 'error'];

export function createLogger(level = 'info') {
  const threshold = LEVELS.indexOf(level);

  function write(kind, ...args) {
    const rank = LEVELS.indexOf(kind);
    if (rank < threshold) return;
    const stamp = new Date().toISOString();
    console.error(`[${stamp}] [${kind}]`, ...args);
  }

  return {
    debug: (...args) => write('debug', ...args),
    info: (...args) => write('info', ...args),
    warn: (...args) => write('warn', ...args),
    error: (...args) => write('error', ...args),
  };
}

export function generateRequestId() {
  return randomUUID().slice(0, 8);
}

export function startTimer() {
  const start = process.hrtime.bigint();
  return {
    elapsedMs() {
      return Number(process.hrtime.bigint() - start) / 1e6;
    },
  };
}
