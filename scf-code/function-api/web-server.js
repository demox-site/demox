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

/**
 * 客户端 IP（只从已经去掉 x-scf-* 的头里取）：
 * 1. 不信任 x-scf-remote-addr：canary（2026-10-10 15:10，经 api.demox.site 自定义域名）实测平台并不注入这个头，
 *    客户端自己带的同名头会原样到达，会被用来伪造 IP、绕过按 IP 的限流。
 * 2. 不信任 x-real-ip（云架构 2026-10-10 确认：不用，开关也不留）。
 * 3. 用 X-Forwarded-For 最右边一个（离我们最近的代理追加的；左边的都可被客户端伪造）。云架构已确认。
 *    注意：如果以后 api.demox.site 放到 EdgeOne 后面，最右边的 XFF 会变成 EdgeOne 节点 IP，
 *    这里必须改成读 EdgeOne 的客户端 IP 头，否则所有用户会共用同一个限流键。
 * 4. 都没有才用 socket 地址（和以前一样）。
 */
function clientIpFrom(headers, socket) {
  const xff = String((headers || {})['x-forwarded-for'] || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (xff.length) return xff[xff.length - 1];
  return (socket && socket.remoteAddress) || '';
}

/**
 * 【临时，上生产前删除】DEMOX_DEBUG_CLIENT_IP=true 时，每个请求打一行：只含 X-Forwarded-For、X-Real-IP、
 * X-Scf-Remote-Addr 三个头的值和 clientIpFrom 的结果，用来在 api-web develop / 函数 URL 上核对 IP 来源。默认关。
 */
function debugClientIpEnabled(env = process.env) {
  return String(env.DEMOX_DEBUG_CLIENT_IP || '').trim().toLowerCase() === 'true';
}

/**
 * 去掉所有 x-scf-* 请求头（入口第一步，任何使用之前）：
 * - X-Scf-Secret-Id / X-Scf-Secret-Key / X-Scf-Session-Token 是运行角色的临时密钥，绝不能进入业务代码、用户函数转发或日志；
 * - 客户端也能自带 x-scf-*（比如伪造的 X-Scf-Remote-Addr），平台不一定覆盖，所以一律不可信。
 */
function stripPlatformHeaders(headers) {
  for (const key of Object.keys(headers)) if (key.toLowerCase().startsWith('x-scf-')) delete headers[key];
  return headers;
}

/** 平台请求 ID 只作日志关联用：必须是 UUID 形状，否则忽略（客户端可能伪造这个头）。 */
const SCF_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let headerNamesLogged = false;

function isTextContentType(contentType) {
  const type = String(contentType || '').toLowerCase();
  return !type || type.startsWith('text/') || type.includes('json') || type.includes('x-www-form-urlencoded') || type.includes('xml') || type.includes('javascript');
}

/** Node 请求 → API 网关风格事件（只放路由需要的字段，不打印任何内容）。 */
function eventFromRequest(req, rawBody, options = {}) {
  const url = new URL(req.url || '/', 'http://localhost');
  const headers = {};
  for (const [key, value] of Object.entries(req.headers || {})) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  const query = {};
  for (const [key, value] of url.searchParams) query[key] = value;
  if (!headerNamesLogged) {
    headerNamesLogged = true; // 每个实例只记一次，只记名字不记值，用来核对平台实际传了哪些头
    console.log(`web-server: request header names: ${Object.keys(headers).sort().join(',')}`);
  }
  // 唯一的例外：取平台请求 ID 做日志关联（只认 UUID 形状），之后立刻去掉全部 x-scf-*，再做任何其他处理。
  const scfRequestId = String(headers['x-scf-request-id'] || '').trim();
  const debugRemoteAddr = options.debugClientIp ? String(headers['x-scf-remote-addr'] || '') : ''; // 【临时】只用于下面的调试日志，不参与 IP 判断
  stripPlatformHeaders(headers);
  const text = isTextContentType(headers['content-type']);
  const requestId = (SCF_REQUEST_ID_PATTERN.test(scfRequestId) ? scfRequestId : '') || firstHeader(headers['x-request-id']) || crypto.randomBytes(8).toString('hex');
  const sourceIp = clientIpFrom(headers, req.socket);
  if (options.debugClientIp) {
    // 【临时，上生产前删除】
    console.log(`web-server: DEBUG client-ip xff=${JSON.stringify(String(headers['x-forwarded-for'] || ''))} x-real-ip=${JSON.stringify(String(headers['x-real-ip'] || ''))} x-scf-remote-addr=${JSON.stringify(debugRemoteAddr)} clientIp=${JSON.stringify(sourceIp)}`);
  }
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

function createWebServer({ handler, logger = console, debugClientIp = debugClientIpEnabled() } = {}) {
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
      const event = eventFromRequest(req, Buffer.concat(chunks), { debugClientIp });
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

module.exports = { createWebServer, eventFromRequest, writeResult, clientIpFrom, stripPlatformHeaders, debugClientIpEnabled };
