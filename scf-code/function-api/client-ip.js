'use strict';

const net = require('net');

/**
 * 受信任的代理网段（代码常量，不走 env）：从 X-Forwarded-For 右边往左走，跳过这些地址，第一个不在名单里的就是客户端 IP。
 * 依据：2026-10-10 实测 api-web 的两条链（函数 URL 和 api.demox.site 自定义域名）形状一样：
 *   [客户端伪造…], 真实客户端, 11.163.x.x（SCF 网关，= X-Real-IP）, 10.132.x.x（内网）
 * 名单按云架构 2026-10-10 15:25 给的清单写死（云架构 15:35 确认为最终版），不要自己加（比如 30/8）。
 * 注意：如果以后 api.demox.site 放到 EdgeOne 后面，EdgeOne 节点是公网地址、不在名单里，会被当成客户端 IP，
 * 那时必须改成读 EdgeOne 的客户端 IP 头。
 */
const TRUSTED_PROXY_CIDRS = Object.freeze([
  '10.0.0.0/8', '11.0.0.0/8', '9.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
  '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16',
  '::1/128', 'fc00::/7', 'fe80::/10'
]);

const trusted = new net.BlockList();
for (const cidr of TRUSTED_PROXY_CIDRS) {
  const [addr, bits] = cidr.split('/');
  trusted.addSubnet(addr, Number(bits), net.isIPv6(addr) ? 'ipv6' : 'ipv4');
}

/** IPv4 映射地址与原 IPv4 使用同一个键，IPv6 使用统一格式。 */
function normalizeIp(value) {
  if (typeof value !== 'string') return '';
  const ip = value.trim();
  if (net.isIPv4(ip)) return ip;
  if (ip.includes('%') || !net.isIPv6(ip)) return '';
  const canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(canonical);
  if (!mapped) return canonical;
  return mapped.slice(1).flatMap((segment) => {
    const value = parseInt(segment, 16);
    return [value >> 8, value & 255];
  }).join('.');
}

function isTrustedProxy(value) {
  const ip = normalizeIp(value);
  const family = net.isIP(ip);
  if (!family) return false; // 不是 IP 的条目不受信任
  return trusted.check(ip, family === 6 ? 'ipv6' : 'ipv4');
}

/** 只在已确认的代理入口使用，从追加在链尾的代理跳点向左找客户端。 */
function clientIpFromForwardedFor(value) {
  const raw = Array.isArray(value) ? value.join(',') : value;
  const parts = String(raw || '').split(',').map((part) => part.trim());
  if (!isTrustedProxy(parts.at(-1))) return '';
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (!isTrustedProxy(parts[i])) return normalizeIp(parts[i]);
  }
  return '';
}

function webClientIp(headers, socket) {
  const peer = normalizeIp(socket?.remoteAddress);
  if (!isTrustedProxy(peer)) return peer;
  return clientIpFromForwardedFor(headers['x-forwarded-for']) || peer;
}

function eventClientIp(context, scfRemoteAddr) {
  if (context && Object.hasOwn(context, 'sourceIp')) return normalizeIp(context.sourceIp);
  // The SCF Event HTTP trigger supplies the peer's IP in x-scf-remote-addr.
  return normalizeIp(context?.identity?.sourceIp || context?.http?.sourceIp) || normalizeIp(scfRemoteAddr);
}

module.exports = {
  TRUSTED_PROXY_CIDRS,
  clientIpFromForwardedFor,
  eventClientIp,
  webClientIp,
  isTrustedProxy,
  normalizeIp
};
