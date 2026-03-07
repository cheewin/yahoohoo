export class YahoohooError extends Error {
  constructor(message, { code, httpStatus = 500, jsonRpcCode = -32603 } = {}) {
    super(message);
    this.name = 'YahoohooError';
    this.code = code || 'INTERNAL_ERROR';
    this.httpStatus = httpStatus;
    this.jsonRpcCode = jsonRpcCode;
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
    };
  }
}

export class ValidationError extends YahoohooError {
  constructor(message) {
    super(message, { code: 'VALIDATION_ERROR', httpStatus: 400, jsonRpcCode: -32602 });
    this.name = 'ValidationError';
  }
}

export class ToolNotFoundError extends YahoohooError {
  constructor(toolName) {
    super(`Tool not found: ${toolName}`, { code: 'TOOL_NOT_FOUND', httpStatus: 404, jsonRpcCode: -32601 });
    this.name = 'ToolNotFoundError';
  }
}

export class SandboxError extends YahoohooError {
  constructor(message) {
    super(message, { code: 'SANDBOX_ERROR', httpStatus: 500, jsonRpcCode: -32603 });
    this.name = 'SandboxError';
  }
}

export class SandboxTimeoutError extends SandboxError {
  constructor(timeoutMs) {
    super(`Sandbox timed out after ${timeoutMs}ms.`);
    this.name = 'SandboxTimeoutError';
    this.code = 'SANDBOX_TIMEOUT';
  }
}

export class DataFetchError extends YahoohooError {
  constructor(message) {
    super(message, { code: 'DATA_FETCH_ERROR', httpStatus: 502, jsonRpcCode: -32603 });
    this.name = 'DataFetchError';
  }
}

export class RateLimitError extends YahoohooError {
  constructor(message = 'Rate limit exceeded. Try again later.') {
    super(message, { code: 'RATE_LIMIT', httpStatus: 429, jsonRpcCode: -32000 });
    this.name = 'RateLimitError';
  }
}

export class AuthError extends YahoohooError {
  constructor(message = 'Authentication required.', httpStatus = 401) {
    super(message, { code: 'AUTH_ERROR', httpStatus, jsonRpcCode: -32000 });
    this.name = 'AuthError';
  }
}

export class SessionLimitError extends YahoohooError {
  constructor(maxSessions) {
    super(`Maximum session limit (${maxSessions}) reached. Try again later.`, {
      code: 'SESSION_LIMIT',
      httpStatus: 503,
      jsonRpcCode: -32000,
    });
    this.name = 'SessionLimitError';
  }
}

export function errorToJsonRpc(error, id = null) {
  if (error instanceof YahoohooError) {
    return {
      jsonrpc: '2.0',
      error: {
        code: error.jsonRpcCode,
        message: error.message,
        data: { errorCode: error.code },
      },
      id,
    };
  }
  return {
    jsonrpc: '2.0',
    error: {
      code: -32603,
      message: 'Internal server error.',
    },
    id,
  };
}
