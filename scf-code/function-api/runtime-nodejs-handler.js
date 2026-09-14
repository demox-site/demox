'use strict';

const crypto = require('crypto');
const { executeNodejsPayload } = require('./runtime-nodejs.js');

/**
 * Secretless Node.js runtime pool. The router (demox-function-api) invokes this
 * function with the user source and site env; this process must not read host
 * platform secrets from its own environment.
 */
async function main(event = {}) {
  const incoming = unwrapRuntimeEvent(event);
  if (incoming.http) {
    const expected = String(process.env.RUNTIME_INVOKE_SECRET || '');
    if (!expected || !tokensEqual(incoming.token, expected)) {
      return httpResponse(401, {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '运行时调用未授权' }
      });
    }
  }
  const payload = incoming.payload;
  if (!payload || payload.type !== 'demox.runtime.execute' || payload.runtime !== 'nodejs') {
    return respond(incoming.http, {
      ok: false,
      error: { code: 'UNSUPPORTED_RUNTIME_PAYLOAD', message: '不是 Node.js 运行时调用' }
    });
  }
  try {
    const result = await executeNodejsPayload({
      source: payload.source,
      sourceHash: payload.sourceHash,
      request: payload.request,
      env: payload.env,
      limits: payload.limits,
      entrypoint: payload.entrypoint,
      packageName: payload.packageName,
      callingConvention: payload.callingConvention
    });
    return respond(incoming.http, { ok: true, result });
  } catch (error) {
    return respond(incoming.http, {
      ok: false,
      error: {
        code: error.code || 'FUNCTION_EXECUTION_ERROR',
        message: error.message || '函数执行失败'
      }
    });
  }
}

function unwrapRuntimeEvent(event = {}) {
  if (event && event.type === 'demox.runtime.execute') {
    return { http: false, token: '', payload: event };
  }
  const http = Boolean(event && (event.httpMethod || event.headers || event.path || event.body));
  if (!http) return { http: false, token: '', payload: event };
  return {
    http: true,
    token: headerValue(event.headers, 'x-demox-runtime-token') || bearerToken(event.headers),
    payload: parseBody(event)
  };
}

function parseBody(event) {
  if (event.body && typeof event.body === 'object' && !Buffer.isBuffer(event.body)) return event.body;
  if (!event.body) return {};
  let raw = String(event.body);
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const wanted = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== wanted) continue;
    return Array.isArray(value) ? String(value[0] || '') : String(value || '');
  }
  return '';
}

function bearerToken(headers) {
  const authorization = headerValue(headers, 'authorization');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function tokensEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function respond(http, payload) {
  return http ? httpResponse(200, payload) : payload;
}

function httpResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
    isBase64Encoded: false
  };
}

module.exports = { main, unwrapRuntimeEvent };
