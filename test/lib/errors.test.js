import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  YahoohooError,
  ValidationError,
  ToolNotFoundError,
  SandboxError,
  SandboxTimeoutError,
  DataFetchError,
  RateLimitError,
  AuthError,
  SessionLimitError,
  errorToJsonRpc,
} from '../../src/lib/errors.js';

describe('YahoohooError', () => {
  it('has default properties', () => {
    const err = new YahoohooError('test');
    assert.equal(err.message, 'test');
    assert.equal(err.code, 'INTERNAL_ERROR');
    assert.equal(err.httpStatus, 500);
    assert.equal(err.jsonRpcCode, -32603);
    assert.ok(err instanceof Error);
  });

  it('serializes to JSON', () => {
    const err = new YahoohooError('test');
    const json = err.toJSON();
    assert.equal(json.error, 'INTERNAL_ERROR');
    assert.equal(json.message, 'test');
  });
});

describe('ValidationError', () => {
  it('has correct code and status', () => {
    const err = new ValidationError('bad input');
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.equal(err.httpStatus, 400);
    assert.equal(err.jsonRpcCode, -32602);
    assert.ok(err instanceof YahoohooError);
  });
});

describe('ToolNotFoundError', () => {
  it('includes tool name in message', () => {
    const err = new ToolNotFoundError('foo_tool');
    assert.match(err.message, /foo_tool/);
    assert.equal(err.code, 'TOOL_NOT_FOUND');
    assert.equal(err.httpStatus, 404);
  });
});

describe('SandboxError', () => {
  it('has correct code', () => {
    const err = new SandboxError('failed');
    assert.equal(err.code, 'SANDBOX_ERROR');
    assert.ok(err instanceof YahoohooError);
  });
});

describe('SandboxTimeoutError', () => {
  it('includes timeout in message', () => {
    const err = new SandboxTimeoutError(5000);
    assert.match(err.message, /5000ms/);
    assert.equal(err.code, 'SANDBOX_TIMEOUT');
    assert.ok(err instanceof SandboxError);
  });
});

describe('DataFetchError', () => {
  it('has correct code and status', () => {
    const err = new DataFetchError('Yahoo down');
    assert.equal(err.code, 'DATA_FETCH_ERROR');
    assert.equal(err.httpStatus, 502);
  });
});

describe('RateLimitError', () => {
  it('has correct defaults', () => {
    const err = new RateLimitError();
    assert.equal(err.code, 'RATE_LIMIT');
    assert.equal(err.httpStatus, 429);
    assert.match(err.message, /Rate limit/);
  });
});

describe('AuthError', () => {
  it('defaults to 401', () => {
    const err = new AuthError();
    assert.equal(err.httpStatus, 401);
    assert.equal(err.code, 'AUTH_ERROR');
  });

  it('accepts custom status', () => {
    const err = new AuthError('forbidden', 403);
    assert.equal(err.httpStatus, 403);
  });
});

describe('SessionLimitError', () => {
  it('includes limit in message', () => {
    const err = new SessionLimitError(50);
    assert.match(err.message, /50/);
    assert.equal(err.code, 'SESSION_LIMIT');
    assert.equal(err.httpStatus, 503);
  });
});

describe('errorToJsonRpc', () => {
  it('converts YahoohooError to JSON-RPC error', () => {
    const err = new ValidationError('bad');
    const rpc = errorToJsonRpc(err, 42);
    assert.equal(rpc.jsonrpc, '2.0');
    assert.equal(rpc.id, 42);
    assert.equal(rpc.error.code, -32602);
    assert.equal(rpc.error.message, 'bad');
    assert.equal(rpc.error.data.errorCode, 'VALIDATION_ERROR');
  });

  it('converts generic Error to internal error', () => {
    const rpc = errorToJsonRpc(new Error('oops'));
    assert.equal(rpc.error.code, -32603);
    assert.equal(rpc.error.message, 'Internal server error.');
  });
});
