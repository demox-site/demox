'use strict';

/**
 * Web 函数入口（v14，用于把 api.demox.site 从 Event 函数迁到 Web 函数）。
 *
 * 为什么：Event 函数的返回值会被 SCF 原样写进日志（`Response RequestId:… RetMsg:…`，关不掉），
 * 而 api.demox.site 的返回值里有登录 JWT、OAuth access/refresh token 和邮箱。
 * Web 函数的 HTTP 响应体不会自动进日志（腾讯云文档：Web 函数场景下各请求的返回 Body 不会自动上报）。
 *
 * 这里把 Node HTTP 请求转成和 API 网关 / 自定义域名一样的事件，交给同一个 createPlatformHandler，
 * 再把 { statusCode, headers, body, isBase64Encoded } 写回 HTTP 响应。业务代码、客户端都不用改。
 * 定时触发器仍留在 Event 函数 demox-function-api 上。
 *
 * 启动：scf_bootstrap → node web-server.js（监听 0.0.0.0:9000）。
 */

const http = require('http');
const crypto = require('crypto');

const MAX_BODY_BYTES = 6 * 1024 * 1024;

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

function isTextContentType(contentType) {
  const type = String(contentType || '').toLowerCase();
  return !type || type.startsWith('text/') || type.includes('json') || type.includes('x-www-form-urlencoded') || type.includes('xml') || type.includes('javascript');
}

/** Node 请求 → API 网关风格事件（只放路由需要的字段，不打印任何内容）。 */
function eventFromRequest(req, rawBody) {
  const url = new URL(req.url || '/', 'http://localhost');
  const headers = {};
  for (const [key, value] of Object.entries(req.headers || {})) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  const query = {};
  for (const [key, value] of url.searchParams) query[key] = value;
  const text = isTextContentType(headers['content-type']);
  const requestId = firstHeader(req.headers['x-scf-request-id']) || firstHeader(req.headers['x-request-id']) || crypto.randomBytes(8).toString('hex');
  const sourceIp = String(headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
  return {
    httpMethod: String(req.method || 'GET').toUpperCase(),
    path: url.pathname,
    headers,
    queryStringParameters: query,
    queryString: query,
    body: rawBody.length ? (text ? rawBody.toString('utf8') : rawBody.toString('base64')) : '',
    isBase64Encoded: rawBody.length > 0 && !text,
    requestContext: { requestId, sourceIp, path: url.pathname, httpMethod: String(req.method || 'GET').toUpperCase() },
    requestId
  };
}

function writeResult(res, result) {
  const out = result && typeof result === 'object' ? result : { statusCode: 200, body: result == null ? '' : String(result) };
  const statusCode = Number(out.statusCode) || 200;
  const headers = { ...(out.headers || {}) };
  for (const [key, values] of Object.entries(out.multiValueHeaders || {})) {
    headers[key] = Array.isArray(values) ? values : [values];
  }
  let body = out.body;
  if (body == null) body = '';
  else if (typeof body !== 'string' && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body);
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json; charset=utf-8';
  }
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), out.isBase64Encoded ? 'base64' : 'utf8');
  for (const key of Object.keys(headers)) {
    if (['content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) delete headers[key];
  }
  res.writeHead(statusCode, { ...headers, 'content-length': payload.length });
  res.end(payload);
}

function createWebServer({ handler, logger = console } = {}) {
  if (typeof handler !== 'function') throw new Error('createWebServer 需要 handler');
  return http.createServer((req, res) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        writeResult(res, { statusCode: 413, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ success: false, error: 'PAYLOAD_TOO_LARGE' }) });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      const event = eventFromRequest(req, Buffer.concat(chunks));
      try {
        const result = await handler(event, { request_id: event.requestId, requestId: event.requestId });
        writeResult(res, result);
      } catch (error) {
        // 只记错误码，不记请求/响应内容。
        logger.error?.('Web 入口处理失败:', (error && (error.code || error.name)) || 'ERROR');
        writeResult(res, {
          statusCode: 500,
          headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
          body: JSON.stringify({ success: false, error: 'INTERNAL_ERROR', requestId: event.requestId })
        });
      }
    });
  });
}

if (require.main === module) {
  const { main } = require('./index.js');
  const port = Number(process.env.PORT || 9000);
  createWebServer({ handler: main }).listen(port, '0.0.0.0', () => {
    console.log(`demox web entry listening on ${port}`);
  });
}

module.exports = { createWebServer, eventFromRequest, writeResult };
