import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PythonSandbox } from '../../src/sandbox/index.js';
import { loadConfig } from '../../src/lib/config.js';
import { createLogger } from '../../src/lib/logger.js';

const config = loadConfig();
const logger = createLogger('error');
const sandbox = new PythonSandbox({ config, logger });

describe('PythonSandbox (Node wrapper)', () => {
  it('runs simple code and returns result', async () => {
    const result = await sandbox.run({
      code: 'RESULT = {"total": sum(DATA["nums"])}',
      inputData: { nums: [1, 2, 3, 4, 5] },
    });
    assert.equal(result.ok, true);
    assert.equal(result.result.total, 15);
  });

  it('returns error for blocked operations', async () => {
    await assert.rejects(
      () => sandbox.run({
        code: 'import os\nRESULT = {}',
        inputData: {},
      }),
      (error) => {
        assert.ok(error.message.includes('failed'));
        return true;
      },
    );
  });

  it('passes metadata through', async () => {
    const result = await sandbox.run({
      code: 'RESULT = {"ok": True}',
      inputData: {},
      metadata: { query: 'test', depth: 0 },
    });
    assert.equal(result.ok, true);
  });

  it('handles syntax errors in code', async () => {
    await assert.rejects(
      () => sandbox.run({
        code: 'def broken(',
        inputData: {},
      }),
      (error) => {
        assert.ok(error.message.includes('failed'));
        return true;
      },
    );
  });
});
