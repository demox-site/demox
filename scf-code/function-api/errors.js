'use strict';

class FunctionApiError extends Error {
  constructor(message, code = 'FUNCTION_ERROR', statusCode = 400, details = undefined) {
    super(message);
    this.name = 'FunctionApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function badRequest(message, code = 'BAD_REQUEST', details) {
  return new FunctionApiError(message, code, 400, details);
}

function unauthorized(message = '需要登录') {
  return new FunctionApiError(message, 'UNAUTHORIZED', 401);
}

function forbidden(message = '没有权限操作此函数') {
  return new FunctionApiError(message, 'FORBIDDEN', 403);
}

function notFound(message = '函数不存在') {
  return new FunctionApiError(message, 'NOT_FOUND', 404);
}

function tooManyRequests(message = '调用过于频繁') {
  return new FunctionApiError(message, 'RATE_LIMITED', 429);
}

function internalError(message = '函数执行失败', details) {
  return new FunctionApiError(message, details?.code || 'INTERNAL_ERROR', 500, details);
}

module.exports = {
  FunctionApiError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  tooManyRequests,
  internalError
};
