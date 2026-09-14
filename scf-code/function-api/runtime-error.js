'use strict';

class FunctionRuntimeError extends Error {
  constructor(message, code = 'FUNCTION_RUNTIME_ERROR', details = undefined) {
    super(message);
    this.name = 'FunctionRuntimeError';
    this.code = code;
    this.details = details;
  }
}

module.exports = { FunctionRuntimeError };
