import fs from 'node:fs';
import path from 'node:path';

const PROGRAMS_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'sandbox', 'programs');

const _cache = new Map();

function loadProgram(name) {
  if (_cache.has(name)) return _cache.get(name);
  const filePath = path.join(PROGRAMS_DIR, `${name}.py`);
  const code = fs.readFileSync(filePath, 'utf-8');
  _cache.set(name, code);
  return code;
}

const PROGRAM_MAP = {
  general: 'market_metrics',
  comparison: 'comparison',
  options: 'options_analysis',
  fundamentals: 'fundamentals',
  risk: 'risk_analysis',
  macro: 'market_metrics',
  portfolio: 'comparison',
};

export function programForIntent(intent) {
  const name = PROGRAM_MAP[intent] || 'market_metrics';
  try {
    return { name, code: loadProgram(name) };
  } catch {
    return { name: 'market_metrics', code: loadProgram('market_metrics') };
  }
}

export function listPrograms() {
  try {
    return fs.readdirSync(PROGRAMS_DIR)
      .filter((f) => f.endsWith('.py'))
      .map((f) => f.replace('.py', ''));
  } catch {
    return [];
  }
}
