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

/** 规范化：去空白；::ffff:a.b.c.d（IPv4 映射）转成 a.b.c.d。不认识的格式原样返回。 */
function normalizeIp(value) {
  const ip = String(value || '').trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return mapped ? mapped[1] : ip;
}

function isTrustedProxy(value) {
  const ip = normalizeIp(value);
  const family = net.isIP(ip);
  if (!family) return false; // 不是 IP 的条目不受信任
  return trusted.check(ip, family === 6 ? 'ipv6' : 'ipv4');
}

/**
 * 从 X-Forwarded-For 取客户端 IP：从右往左跳过受信任代理，返回第一个不受信任的地址（规范化后）。
 * 整条链都受信任时返回最右边一个（规范化后），绝不取最左边（可被客户端伪造）。没有 XFF 返回 ''（调用方再退回 socket 地址）。
 */
function clientIpFromForwardedFor(value) {
  const parts = String(value || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (!parts.length) return '';
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (!isTrustedProxy(parts[i])) return normalizeIp(parts[i]);
  }
  return normalizeIp(parts[parts.length - 1]);
}

module.exports = { TRUSTED_PROXY_CIDRS, clientIpFromForwardedFor, isTrustedProxy, normalizeIp };
