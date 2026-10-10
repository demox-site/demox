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

// 已知的 4xx 业务错误（限流、参数、鉴权、不存在等），事件入口和 Web 入口都按同一形状返回。
function isClientError(error) {
  return error instanceof FunctionApiError && error.statusCode >= 400 && error.statusCode < 500;
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization'
  };
}

// 统一的错误响应：{ success:false, error:<code>, message, requestId }，带 CORS 和 x-demox-request-id。
// 只带错误码和我们自己写的 message，不带请求内容或用户代码的错误详情。
function typedErrorResponse(error, requestId) {
  return {
    statusCode: error.statusCode,
    headers: { ...corsHeaders(), 'x-demox-request-id': requestId },
    body: JSON.stringify({ success: false, error: error.code, message: error.message, requestId }),
    isBase64Encoded: false
  };
}

module.exports = {
  FunctionApiError,
  isClientError,
  corsHeaders,
  typedErrorResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  tooManyRequests,
  internalError
};
