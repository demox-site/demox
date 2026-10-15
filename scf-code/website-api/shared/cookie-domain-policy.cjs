const psl = require('psl');

// 自定义域登录 cookie 的范围。只用 host-only，绝不写 Domain=。
// eTLD+1（example.co.uk）上的其它主机不是这个站点；公共后缀（co.uk、github.io、blogspot.com）
// 不能当 cookie domain。psl.parse 没有 registrable domain 时，主机本身就是公共后缀。
function cookieDomainScope(hostname) {
  const host = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .replace(/:\d+$/, '')
    .replace(/^\.+|\.+$/g, '');
  if (!host || host.length > 253 || host.includes('..') || !host.includes('.')) {
    return { mode: 'refuse', reason: 'invalid' };
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return { mode: 'refuse', reason: 'ip' };
  }
  if (host === 'demox.site' || host.endsWith('.demox.site')) {
    return { mode: 'refuse', reason: 'official' };
  }
  const parsed = psl.parse(host);
  if (!parsed || parsed.error || !parsed.domain) {
    return { mode: 'refuse', reason: 'public-suffix' };
  }
  return { mode: 'host-only', host, registrable: parsed.domain };
}

function customDomainAuthCookieHeader(hostname, token, maxAge) {
  const scope = cookieDomainScope(hostname);
  if (scope.mode !== 'host-only') return '';
  const value = String(token || '');
  if (!value || value.length > 16384) return '';
  const age = Number(maxAge);
  if (!Number.isFinite(age) || age <= 0) return '';
  const header = 'demox_access=' + encodeURIComponent(value) +
    '; Max-Age=' + String(age) +
    '; Path=/; HttpOnly; Secure; SameSite=Lax';
  if (/domain\s*=/i.test(header)) return '';
  return header;
}

module.exports = { cookieDomainScope, customDomainAuthCookieHeader };
