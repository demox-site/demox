'use strict';

/**
 * 临时 IP 调试端点（只为排查限速 IP 提取，排查完立刻删掉，不合并到 master）。
 *
 * GET /__debug/ip 只在 develop 别名指向的那个版本上响应：SCF Event 函数的 context 里没有别名名字，
 * 只有解析后的 function_version，所以这里写死只在版本 IP_DEBUG_FUNCTION_VERSION 上开放
 * （这个版本只挂在 develop 别名上，production 别名仍是 6，旧版本里根本没有这段代码）。
 * 其他任何版本（包括 $LATEST）都当作不存在，交给原来的处理器。
 *
 * 只返回 IP 相关信息：网关 sourceIp + IP 类请求头。不返回 token、cookie、authorization、body、其他头，不写日志。
 */
const { clientIpFromForwardedFor } = require('./client-ip.js');

const IP_DEBUG_PATH = '/__debug/ip';
const IP_DEBUG_FUNCTION_VERSION = '7';
// 平台若在 context 里给的是别名名字而不是版本号，也只认 develop。
const IP_DEBUG_QUALIFIERS = new Set([IP_DEBUG_FUNCTION_VERSION, 'develop']);
const IP_HEADER_PATTERN = /^(x-forwarded-for|x-real-ip|x-scf-remote-addr|x-client-ip|x-original-forwarded-for|forwarded|forwarded-for|x-forwarded|x-cluster-client-ip|true-client-ip|cf-connecting-ip|eo-connecting-ip|eo-client-ip|eo-connecting-region|x-remote-addr|x-remote-ip|remote-addr|x-originating-ip|x-host-ip|x-tencent-client-ip|ali-cdn-real-ip|cdn-src-ip|x-forwarded-host-ip)$/;
const IP_HEADER_LOOSE = /(^|-)(ip|client-ip|real-ip|remote-addr|connecting-ip|forwarded-for)$/;
const NEVER = /cookie|authorization|token|secret|key|session|signature/;

function ipHeaders(headers) {
  const out = {};
  for (const [rawKey, value] of Object.entries(headers || {})) {
    const key = String(rawKey).toLowerCase();
    if (NEVER.test(key)) continue;
    if (!IP_HEADER_PATTERN.test(key) && !IP_HEADER_LOOSE.test(key)) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : String(value == null ? '' : value).slice(0, 512);
  }
  return out;
}

function isIpDebugRequest(event, context) {
  const path = String(event?.path || event?.rawPath || event?.requestContext?.http?.path || '');
  const method = String(event?.httpMethod || event?.requestContext?.http?.method || '').toUpperCase();
  return path === IP_DEBUG_PATH && method === 'GET' && IP_DEBUG_QUALIFIERS.has(String(context?.function_version || ''));
}

function ipDebugResponse(event, context) {
  const headers = ipHeaders(event?.headers);
  const xff = headers['x-forwarded-for'] || '';
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify({
      functionVersion: String(context?.function_version || ''),
      requestContextSourceIp: event?.requestContext?.sourceIp ?? null,
      requestContextIdentitySourceIp: event?.requestContext?.identity?.sourceIp ?? null,
      ipHeaders: headers,
      // service.js 当前的取法：requestContext.sourceIp || clientIpFromForwardedFor(xff) || 'anonymous'
      currentClientKey: event?.requestContext?.sourceIp || clientIpFromForwardedFor(xff) || 'anonymous',
      xffParsed: clientIpFromForwardedFor(xff) || null
    })
  };
}

function withIpDebug(handler) {
  return async function main(event = {}, context = {}) {
    if (isIpDebugRequest(event, context)) return ipDebugResponse(event, context);
    return handler(event, context);
  };
}

module.exports = { withIpDebug, ipHeaders, isIpDebugRequest, ipDebugResponse, IP_DEBUG_FUNCTION_VERSION };
