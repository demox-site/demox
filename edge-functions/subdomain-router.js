/**
 * EdgeOne 边缘函数：subdomain-router
 * ---------------------------------------------------------------------------
 * 作用：处理官方域名池的访问。每个站点默认域名 = <websiteId 小写>.demox.site，
 * 另可选配一个自定义前缀。两者都查同一张路由表(websites 表):
 *   {label}.{officialDomain} → 调 website-api /resolve-subdomain 查 label+domain→path
 *   (demox.site 下 label 可匹配 websites.subdomain 或 LOWER(website_id))→ 回源 /{path}/{rest}
 * 结果走边缘 Cache(命中 60s、不存在 15s、出错不缓存，见 cachedResolve)。旧的 sites-{userId}-{fileId}-{dir} 格式已废弃。
 *
 * 源站路径（K2）：sites.demox.site、site-N、sites-*、origin-* 在回源前按站点 ID 裁决。
 * 其它 host 上，解码一次（百分号或 UTF-8 失败则 400）、去掉 Cf 格式字符并忽略大小写后，
 * 第一段以 sites 开头的路径在两条透传之前也进入同一裁决。
 * 允许和封禁都只新鲜 15s：新封禁约 15s 内 403，解封约 15s 内回到 200。没有 stale 宽限。
 * 子域名和自定义域不走这支，它们的解析缓存仍是命中 60s / 负缓存 15s / stale-if-error 600s。
 * 放行对象的 max-age 只写给客户端，不改变 EdgeOne 节点缓存 TTL。
 * 命中 *.demox.site 的函数规则时，函数先于节点缓存执行；节点缓存只出现在函数自己的 fetch 子请求里
 * （URL host 与 Host 头都和客户端一致时）。封禁在那次 fetch 之前返回 403 + no-store，所以已缓存的对象不会被送回客户端。
 * 若以后把缓存规则配到函数规则之前，HIT 会跳过守卫，那时要按 website-api 的 origin prefix 做 purge。
 * 内部回源用 HMAC（DEMOX_ORIGIN_GUARD_SECRET_A / _B，仓库留空；签名槽由 DEMOX_ORIGIN_GUARD_KID 指定）。
 * 不用可伪造的普通头、UA 或 query。密钥未设置、短于 32 字节，或 KID 不是 A/B 时不签发。
 * 这种情况每个实例只打一条警告，警告里没有任何配置值。伪造头校验失败，守卫照常执行。
 *
 * 路由表用现有 MySQL，不用 KV(标准版 EdgeOne 边缘函数无法绑定 Pages KV,
 * 但支持 fetch 子请求)。
 *
 * 部署/共存策略：
 *   - 与旧函数 ef-7ej45f3q 都匹配 host=*.demox.site；本函数接管该规则。
 *   - 回滚：把触发规则的 FunctionId 改回 ef-7ej45f3q。
 */

// Backend URLs are read from EdgeOne environment variables for quick rollback.
var RESOLVE_CACHE_TTL = 60; // 秒：命中结果的新鲜期
var RESOLVE_NEGATIVE_TTL = 15; // 秒：后端明确「不存在」的新鲜期（超时/出错不缓存）
// 秒：stale-if-error 窗口。只在后端出错/超时时使用，且只用于最近一次成功解析为「正常可访问」的结果；
// 被封禁 / 已删除 / 不存在的结果会覆盖它，永远不会被兜底「复活」。
var RESOLVE_STALE_IF_ERROR_TTL = 600;
var RESOLVE_TIMEOUT_MS = 6000; // 单次 resolve 子请求超时
var RESOLVE_ATTEMPTS = 2; // 首次 + 1 次重试
var RESOLVE_RETRY_DELAY_MS = 200;
// 解析缓存 key 版本。旧 key（resolve.demox.site/host/... 无版本）上的条目会被直接绕开。
var RESOLVE_CACHE_VERSION = 2;
var RESOLVE_CACHE_PREFIX = 'https://resolve.demox.site/v2/';
var RESOLVE_NOT_FOUND_MESSAGES = ['not found', 'unsupported official domain', 'missing subdomain'];
// 旧版本（无版本号）解析缓存 key 前缀。仅在 v2 无条目且后端出错时读取（v1fallback）。
var RESOLVE_LEGACY_CACHE_PREFIX = 'https://resolve.demox.site/';
// 回源（站点文件）单次超时与次数。site-3 等 HTTP 源站跨境偶发 ~17s 挂起/重置（2026-10-08 诊断）。
var ORIGIN_TIMEOUT_MS = 8000;
var ORIGIN_ATTEMPTS = 2;
var SITE_UNAVAILABLE_RETRY_AFTER = 10; // 秒
// 源站 host 守卫。sites.demox.site、site-N、sites-*（含桶 3 私有源站 sites-eclick）、origin-*。
var ORIGIN_GUARD_HOSTS = ['sites.demox.site'];
var ORIGIN_GUARD_HOST_RE = /^(?:site-\d+|sites-[a-z0-9-]+|origin-[a-z0-9-]+)\.demox\.site$/;
// by-ID 解析缓存。允许和封禁同一窗口：新封禁约 15s 内 403，解封约 15s 内 200。
// 不允许把「允许」单独留 60s，那会挡住新封禁；也不把封禁裁决负缓存留得更长。
// 子域名 / 自定义域的 RESOLVE_CACHE_TTL（60s）不参与这次裁决，所以保持不动。
// 过期后再遇到解析失败是 503，不回源。
var ORIGIN_RESOLVE_BAN_TTL = 15;
var ORIGIN_RESOLVE_FOUND_TTL = 15;
var ORIGIN_RESOLVE_NEGATIVE_TTL = 15;
// by-ID 整次查询的硬预算，含至多一次重试（maxAttempts = 2）。与用户站单次
// RESOLVE_TIMEOUT_MS（6000）对齐：挂起时不要比普通解析更久，也不要放宽到两次 6s。
// 单次尝试 4000ms。线上 api.demox.site 约 1.0–1.5s（大约一半是 TLS，一半是服务端）；
// 700ms 会在握手结束前 abort，1500ms 总预算连一次完整往返都不够，于是每次都失败关闭。
// 4000ms 盖住这次实测，也盖住 2.5s 的慢后端，并且在 6000ms 里给一次重试留出约 2s
// （仍大于 1.5s 的实测）。重试间隔保持 50ms。超时仍是 error：不写缓存、不回源。
var ORIGIN_RESOLVE_BUDGET_MS = 6000;
var ORIGIN_RESOLVE_ATTEMPT_MS = 4000;
var ORIGIN_RESOLVE_RETRY_DELAY_MS = 50;
// 放行对象写给浏览器的 Cache-Control。不设置 EdgeOne 节点缓存 TTL，也不写 s-maxage。
// 节点上的缓存命中绕不过守卫：命中函数规则时函数先执行，封禁在 fetch 之前 403。
// 浏览器仍可能按这个 max-age 保留副本，最长 60s 不回边缘。边缘封禁时钟是 15s。
// 若产品要求浏览器也在 15s 内停，要另改这个常量。
var ORIGIN_OBJECT_MAX_AGE = 60;
// 上线默认关闭，与现网 baseline 一致（启明 + 云帆，#84）。
// 只有布尔 true 才打开完整 CORS：OPTIONS 与放行的 GET/HEAD 带齐固定头，
// 400/403/404/405/503 仍然不带。环境变量缺失、字符串、数字或其他写法都当作关闭，
// 避免拼写错误把 CORS 打开。不回显请求的 Origin，也不发送 Allow-Credentials。
var CORS_ENABLED = false;
var ORIGIN_OPTIONS_CORS_ALLOW_HEADERS = 'Range, If-None-Match, If-Modified-Since';
var ORIGIN_CORS_EXPOSE_HEADERS = 'Content-Length, Content-Range, ETag, Last-Modified';
// 内部回源令牌 v1.<kid>.<exp>.<mac>。A/B 两个槽都参与校验；签名用 KID 点名的那个槽。
// 短于 32 字节当作没配。仓库不放密钥值，由云帆用 Secret 配置。旧的单槽变量不再读取。
var ORIGIN_GUARD_SECRET_SLOTS = { A: 'DEMOX_ORIGIN_GUARD_SECRET_A', B: 'DEMOX_ORIGIN_GUARD_SECRET_B' };
var ORIGIN_GUARD_KID_ENV = 'DEMOX_ORIGIN_GUARD_KID';
var ORIGIN_GUARD_MIN_SECRET_BYTES = 32;
var ORIGIN_INTERNAL_TOKEN_HEADER = 'x-demox-origin-token';
var ORIGIN_INTERNAL_TOKEN_TTL_MS = 20000;
var ORIGIN_TOKEN_CLOCK_SKEW_MS = 5000;
var ORIGIN_UID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// 不符合 /sites/<uid>/<ID>/ 的源站路径默认 403。www 的兜底路径本身就是
// sites/1985655011013808129/EPX2UU43/dist，走正常 ID 裁决，不是例外。
// robots.txt、favicon、health、/_/ 没有被边缘函数或 website-api 当成平台路径去拉，所以名单为空。
var ORIGIN_GUARD_ALLOWLIST = [];
// 与 website-api RESERVED_LABELS 一致：这些 label 不可能是用户站点（sites.demox.site 是 www 的回源域）。
var INFRA_LABELS = ['www', 'sites', 'kv-admin', 'api', 'app', 'admin', 'mail', 'ftp', 'cdn', 'static', 'assets', 'blog', 'demox'];
var VISIBILITY_PRIVATE = 'private';
var VISIBILITY_DISABLED = 'disabled';
// EdgeOne response.text() 超过 1MB 抛 OverSize。异常被 passThroughOnException
// 回源到默认桶根，已发布的大页面会变成 404。到上限就不再整页读取。
var MAX_BADGE_HTML_BYTES = 1000000;

// 自托管 demox 主站（作为被 demox 托管的站点 EPX2UU43，发布走 demox cli，不再走 GitHub Actions→COS 根）：
//   - apex demox.site：301 跳转到 www.demox.site（保留 path+query，OAuth code 不丢）。
//   - www.demox.site：优先走路由表（DB websites.subdomain='www' → path）；
//     resolve 失败时用 WWW_FALLBACK_PATH 兜底，绝不放行回源已清空的桶根。
var APEX_HOST = 'demox.site';        // 跳转源
var WWW_HOST = 'www.demox.site';     // 主站承载域名
var DEFAULT_OFFICIAL_DOMAIN = 'demox.site';
var OFFICIAL_DOMAINS = ['demox.site'];
var WWW_FALLBACK_PATH = 'sites/1985655011013808129/EPX2UU43/dist'; // www 兜底 path（改绑主站时同步改 DB 与此）
var WWW_SPA_ROUTES = [
  '/', '/index', '/pricing', '/doc', '/content-scan', '/ai-static-site-deployment', '/layout-demo', '/terms', '/privacy', '/log',
  '/when-to-use-demox', '/deploy-troubleshooting', '/how-demox-hosts-itself',
  '/free-static-site-hosting', '/ai-website-deployment', '/mcp-website-deployment', '/cli-static-site-deploy',
  '/deploy-ai-generated-website', '/claude-code-deploy-website', '/cursor-deploy-website', '/codex-deploy-website',
  '/free-html-hosting', '/deploy-dist-folder', '/deploy-vite-app', '/deploy-react-build',
  '/netlify-drop-alternative', '/surge-alternative', '/vercel-alternative-for-static-sites',
  '/mcp-login', '/mcp-authorize', '/github-callback', '/github-link',
  '/feishu-callback', '/feishu-link', '/site-auth', '/home', '/admin', '/mcp', '/docs'
];
var DEMOX_BADGE_MARKER = 'data-demox-site-badge';
var DEMOX_AUTH_COOKIE = 'demox_access';
var DEMOX_SITE_AUTH_COMPLETE_PATH = '/.demox/auth-complete';
var DEMOX_SITE_AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

// 2026-10-10 账号令牌 cookie 止血（#53，三次失败后的可发布版本）：
//   1) 静态 / 源站 / 透传保持 #49 之前的 fetch(req)，不重建请求、不改头、不剥 cookie。
//   2) 只在 /api/* 函数转发（proxySiteFunction）剥离 demox_access。
//   3) 官方域名请求带着旧 cookie 时，响应追加两条过期 Set-Cookie（父域 + host-only）。
//   4) *.demox.site 私有站点不再认这个 cookie，先返回「需要重新验证」。
// 自定义域私有站点不走第 4 条：登录成功只写 host-only cookie（无 Domain=）。
// 公共后缀拒绝在 website-api（psl）里做，check-site-access 回 cookieScope=refuse 时边缘不写 cookie。
function isAuthCookiePair(part) {
  const p = String(part || '').trim();
  const eq = p.indexOf('=');
  const name = (eq === -1 ? p : p.slice(0, eq)).trim();
  return name === DEMOX_AUTH_COOKIE;
}

function stripAuthCookieValue(raw) {
  return String(raw || '')
    .split(';')
    .map(function (part) { return part.trim(); })
    .filter(function (part) { return part && !isAuthCookiePair(part); })
    .join('; ');
}

function hasAuthCookie(headers) {
  const raw = headers && headers.get ? (headers.get('cookie') || '') : '';
  return raw ? raw.split(';').some(isAuthCookiePair) : false;
}

function withoutAuthCookieHeaders(source) {
  const headers = new Headers(source);
  const raw = headers.get('cookie');
  if (raw === null) return headers;
  const rest = stripAuthCookieValue(raw);
  if (rest) {
    headers.set('cookie', rest);
  } else {
    headers.delete('cookie');
  }
  return headers;
}

function isOfficialDomain(domain) {
  return OFFICIAL_DOMAINS.indexOf(String(domain || '').toLowerCase()) !== -1;
}

function officialDomainOfHost(host) {
  const h = String(host || '').toLowerCase().replace(/\.+$/, '');
  for (let i = 0; i < OFFICIAL_DOMAINS.length; i += 1) {
    const d = OFFICIAL_DOMAINS[i];
    if (h === d || h.endsWith('.' + d)) return d;
  }
  return '';
}

function expireAuthCookieHeaders(domain) {
  const gone = '=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/';
  return [
    DEMOX_AUTH_COOKIE + gone + '; Domain=.' + domain + '; Secure; SameSite=Lax',
    DEMOX_AUTH_COOKIE + gone + '; Secure; SameSite=Lax'
  ];
}

function withExpiredAuthCookie(resp, domain) {
  if (!resp || !domain) return resp;
  try {
    const out = new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: new Headers(resp.headers) });
    const values = expireAuthCookieHeaders(domain);
    for (let i = 0; i < values.length; i += 1) out.headers.append('Set-Cookie', values[i]);
    return out;
  } catch (e) {
    return resp;
  }
}

// 自定义域：只写 host-only。不写 Domain=，避免扩到 eTLD+1 或公共后缀。
// 主机本身是不是公共后缀，由 website-api 的 psl 判断（边缘单文件带不了公共后缀表）。
function customDomainAuthCookieHeader(host, token) {
  const h = String(host || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!h || h.length > 253 || h.indexOf('..') !== -1 || h.indexOf('.') === -1) return '';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return '';
  if (officialDomainOfHost(h)) return '';
  const value = String(token || '');
  if (!value || value.length > 16384) return '';
  const header = DEMOX_AUTH_COOKIE + '=' + encodeURIComponent(value) +
    '; Max-Age=' + DEMOX_SITE_AUTH_COOKIE_MAX_AGE +
    '; Path=/; HttpOnly; Secure; SameSite=Lax';
  if (/domain\s*=/i.test(header)) return '';
  return header;
}

function runtimeEnv(name) {
  try {
    if (typeof env !== 'undefined' && env && env[name]) {
      return String(env[name]).replace(/\/+$/, '');
    }
  } catch (e) {}
  return '';
}

function requiredRuntimeEnv(name) {
  const value = runtimeEnv(name);
  if (!value) throw new Error('Missing EdgeOne environment variable: ' + name);
  return value;
}

function backendUrl(path) {
  return requiredRuntimeEnv('DEMOX_API_URL') + path;
}

function optionalBackendUrl(path) {
  const base = runtimeEnv('DEMOX_API_URL');
  return base ? base + path : '';
}

function isSiteApiPath(pathname) {
  return String(pathname || '').split('?')[0].indexOf('/api/') === 0;
}

function proxySiteFunction(req, websiteId, u) {
  const siteId = String(websiteId || '').trim();
  const base = runtimeEnv('DEMOX_API_URL');
  if (!siteId || !base) {
    return new Response('Site function is not configured', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  const target = base + '/' + encodeURIComponent(siteId) + '/production' + u.pathname + u.search;
  const headers = withoutAuthCookieHeaders(req.headers);
  headers.delete('host');
  const init = {
    method: req.method,
    headers: headers
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    init.duplex = 'half';
  }
  let proxied;
  try {
    proxied = new Request(target, init);
  } catch (e) {
    delete init.duplex;
    proxied = new Request(target, init);
  }
  return fetch(proxied);
}

function demoxHomeUrl() {
  return (runtimeEnv('DEMOX_HOME_URL') || ('https://' + WWW_HOST)).replace(/\/+$/, '') + '/';
}

function parseOfficialHost(host) {
  const normalized = String(host || '').trim().toLowerCase().replace(/\.+$/, '');
  for (let i = 0; i < OFFICIAL_DOMAINS.length; i += 1) {
    const domain = OFFICIAL_DOMAINS[i];
    const suffix = '.' + domain;
    if (!normalized.endsWith(suffix)) continue;
    const label = normalized.slice(0, -suffix.length);
    if (label && label.indexOf('.') === -1) {
      return { label: label, domain: domain };
    }
  }
  return null;
}

addEventListener('fetch', (event) => {
  // 异常时回源，避免整站 500
  event.passThroughOnException();
  event.respondWith(handle(event.request, event));
});

function buildOriginUrl(req, originPath, search, originHost) {
  const origin = new URL(req.url);
  // 多云：回源域由路由表的 origin_host 决定（每个桶绑定自己的回源域）。
  // 缺省(旧数据/默认桶/resolve 未返回 origin)回退到 sites.demox.site。
  // 测试映射打开时，逻辑上的 sites.demox.site 换成映射里的物理主机（k2t-sites），
  // 子请求才会重新进入测试函数。入站 Request 和 Host 头不动。
  const host = physicalOriginHost(originHost || 'sites.demox.site');
  origin.hostname = host;
  // site-{bucketId}.demox.site 是 COS 自定义源站域（CNAME 到 COS，不进 EdgeOne）。
  // 证书还没绑到 COS HTTPS 实例时只能走 HTTP；用户侧仍是 https://*.demox.site。
  if (/^site-\d+\.demox\.site$/i.test(host)) {
    origin.protocol = 'http:';
  }
  origin.pathname = originPath.replace(/\/+/g, '/');
  origin.search = search;
  return origin.toString();
}

// 判断 404 是否应回退到 SPA 的 index.html。
// 目标：让每个站点的体验等同于「独占一个桶根的 SPA 静态托管」(Netlify/Vercel 风格)。
//   - 页面导航请求(浏览器地址栏/刷新，Accept 优先 text/html) → 回退，前端路由接管。
//   - 静态资源请求(.js/.css/.png/.json…，或 fetch/XHR 的 */*) → 保持 404，
//     绝不把缺失的资源伪装成 HTML(否则缺失的 chunk.js 返回 HTML，浏览器静默解析失败，极难排查)。
function shouldFallbackToIndex(req, originPath) {
  const last = (originPath.split('?')[0].split('/').pop() || '').toLowerCase();
  if (last.includes('.')) {
    // 带扩展名：只有 .html/.htm 当作页面，其余一律按静态资源处理(404 保持 404)
    return /\.html?$/.test(last);
  }
  // 无扩展名：看是不是浏览器导航请求(Accept 含 text/html)。
  // 资源/接口请求(Accept: */*、image/*、application/json 等)不回退。
  const accept = (req.headers.get('accept') || '').toLowerCase();
  return accept.includes('text/html');
}

function isWwwSpaRoute(pathname) {
  const normalized = String(pathname || '/').replace(/\/+$/, '') || '/';
  if (
    normalized === '/console' || normalized === '/console/projects' ||
    normalized === '/console/deploy' || normalized === '/console/sites' ||
    normalized === '/console/usage' || normalized === '/console/tokens' ||
    normalized === '/console/settings' || normalized === '/console/admin' ||
    normalized === '/console/functions'
  ) return true;
  if (/^\/console\/admin\/[^/]+$/.test(normalized)) return true;
  if (/^\/console\/projects\/[^/]+\/(deploy|sites|members|settings)$/.test(normalized)) return true;
  // 站点设置 / 站点分析 / 站点函数（App.tsx: projects/:projectId/sites/:websiteId[/analytics|/functions]）
  if (/^\/console\/projects\/[A-Za-z0-9_-]+\/sites\/[A-Za-z0-9_-]+(\/(analytics|functions))?$/.test(normalized)) return true;
  return WWW_SPA_ROUTES.includes(normalized);
}

function getRequestCountry(req) {
  const candidates = [
    'eo-country-code',
    'cf-ipcountry',
    'x-vercel-ip-country',
    'x-country-code',
    'x-geo-country',
    'cloudfront-viewer-country'
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const value = (req.headers.get(candidates[i]) || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(value)) return value;
  }
  try {
    const cfCountry = req.cf && req.cf.country;
    if (/^[A-Z]{2}$/.test(String(cfCountry || '').toUpperCase())) return String(cfCountry).toUpperCase();
  } catch (e) {}
  return 'UNKNOWN';
}

function getRequestProvince(req) {
  const candidates = [
    'eo-region',
    'eo-province',
    'x-vercel-ip-country-region',
    'x-region',
    'x-geo-region',
    'cloudfront-viewer-country-region',
    'x-appengine-region'
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const value = (req.headers.get(candidates[i]) || '').trim();
    if (value) return value.slice(0, 64);
  }
  try {
    const region = req.cf && (req.cf.region || req.cf.regionCode);
    if (region) return String(region).slice(0, 64);
  } catch (e) {}
  return 'UNKNOWN';
}

function getRequestIp(req) {
  const candidates = [
    'eo-connecting-ip',
    'cf-connecting-ip',
    'x-real-ip',
    'x-forwarded-for',
    'true-client-ip',
    'fastly-client-ip'
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const value = (req.headers.get(candidates[i]) || '').trim();
    if (value) return value.split(',')[0].trim().slice(0, 128);
  }
  return '';
}

async function trackSiteEvent(req, event, meta, type) {
  if (!event || !meta || !meta.websiteId) return;
  const url = optionalBackendUrl('/website/analytics-track');
  if (!url) return;
  const u = new URL(req.url);
  const body = {
    action: 'track_site_event',
    websiteId: meta.websiteId,
    type: type || 'view',
    host: u.hostname,
    path: u.pathname,
    referrer: req.headers.get('referer') || req.headers.get('referrer') || '',
    country: getRequestCountry(req),
    province: getRequestProvince(req),
    ip: getRequestIp(req),
    userAgent: req.headers.get('user-agent') || ''
  };
  const token = runtimeEnv('DEMOX_ANALYTICS_TOKEN');
  if (token) body.analyticsToken = token;
  try {
    event.waitUntil(fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(function () {}));
  } catch (e) {}
}


// 错误响应（含 COS NoSuchKey 404、站点 404.html、Demox 兜底 404）一律 no-store：
// 否则边缘把 404 缓存 60s，新部署/重部署后的首批访问会持续看到旧 404。
function isUncacheableStatus(status) {
  const n = Number(status);
  return Number.isFinite(n) && n >= 400;
}

function applySiteCacheHeaders(headers, meta, status) {
  const h = headers instanceof Headers ? headers : new Headers(headers);
  // 2024-01-01 后新建的 COS 桶，默认域名（含 cos-website）会强制
  // Content-Disposition: attachment + x-cos-force-download。浏览器顶层导航会变成下载 HTML。
  // 边缘函数回源后再吐给用户，必须剥掉这两头，页面才能打开。
  const disposition = (h.get('Content-Disposition') || h.get('content-disposition') || '').toLowerCase();
  if (disposition.includes('attachment') || (h.get('x-cos-force-download') || '').toLowerCase() === 'true') {
    h.delete('Content-Disposition');
    h.delete('content-disposition');
    h.delete('x-cos-force-download');
  }
  if ((meta && meta.visibility === VISIBILITY_PRIVATE) || isUncacheableStatus(status)) {
    h.set('Cache-Control', 'no-store');
    h.delete('Age');
    h.delete('Expires');
    return h;
  }
  const cc = (h.get('Cache-Control') || '').toLowerCase();
  if (!cc || cc.includes('no-store') || (cc.includes('no-cache') && cc.indexOf('max-age=') === -1)) {
    h.set('Cache-Control', 'public, max-age=60');
  }
  return h;
}

// P0 2026-09-14：站点已 resolve 时必须走这里。回源 404 只允许 SPA fallback
// 或该站点自己的 404.html，禁止当成「站点未发布」。
// docs/incidents/2026-09-14-p0-unknown-subdomain-404-outage.md
function originDelay(ms) {
  if (!(ms > 0) || typeof setTimeout !== 'function') return null;
  let timer = null;
  const promise = new Promise(function (resolve) { timer = setTimeout(resolve, ms); });
  return {
    promise: promise,
    cancel: function () { if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer); }
  };
}

// 站点文件回源：单次 ORIGIN_TIMEOUT_MS 超时，GET/HEAD 失败(抛错或超时)再试一次。
// 成功后在 meta.originState 记 'ok' 或 'retry'；全部失败抛错（由调用方映射成 503）。
async function fetchSiteOrigin(url, init, meta) {
  const method = String((init && init.method) || 'GET').toUpperCase();
  const attempts = (method === 'GET' || method === 'HEAD') ? Math.max(1, ORIGIN_ATTEMPTS) : 1;
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    const delay = originDelay(ORIGIN_TIMEOUT_MS);
    try {
      // 密钥为空时 attach 返回原来的 init（用户站点就是入站 req）。有密钥才换成带令牌、不带 Host 的普通 init。
      init = await attachOriginToken(url, init);
      const attempt = fetch(url, init);
      const resp = delay
        ? await Promise.race([
          attempt,
          delay.promise.then(function () { throw new Error('origin timeout ' + ORIGIN_TIMEOUT_MS + 'ms'); })
        ])
        : await attempt;
      if (meta && meta.originState !== 'retry') meta.originState = i === 0 ? 'ok' : 'retry';
      return resp;
    } catch (e) {
      lastError = e;
      if (meta) meta.originState = 'retry';
    } finally {
      if (delay) delay.cancel();
    }
  }
  if (meta) meta.originState = 'error';
  throw lastError || new Error('origin fetch failed');
}

function isWwwRequest(u) {
  return logicalHostName(u && u.hostname) === WWW_HOST;
}

function normalizeStoredOriginPath(path) {
  return String(path || '').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

function joinStoredOriginPath(stored, rest) {
  const base = normalizeStoredOriginPath(stored);
  const tail = String(rest || '').replace(/^\/+/, '');
  if (base && tail) return '/' + base + '/' + tail;
  return '/' + (base || tail);
}

// 折叠并去掉首尾斜杠之后再解码一次。反斜杠在原文里出现即拒绝。
// 解码抛错，或解码后仍剩 %，也拒绝。点号只在某一整段解码后正好是 . 或 .. 时拒绝。
// v1.2、my.site 这种段名保持可回源。
function storedOriginPathUnsafe(path) {
  const base = normalizeStoredOriginPath(path);
  if (!base) return false;
  if (base.indexOf('\\') !== -1) return true;
  let decoded;
  try {
    decoded = decodeURIComponent(base);
  } catch (e) {
    return true;
  }
  if (decoded.indexOf('%') !== -1 || decoded.indexOf('\\') !== -1) return true;
  const segments = decoded.split('/');
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i] === '.' || segments[i] === '..') return true;
  }
  return false;
}

async function rewriteOrigin(req, event, u, originPath, sitePath, originHost, meta) {
  // 只验用户请求路径。库里的 path 可能带首尾斜杠（storage prefix 以 / 结尾），
  // 拼进去再验会把整个站点打成 400。拼之前已经 normalizeStoredOriginPath。
  if (originPathUnsafe(u && u.pathname)) {
    if (meta) meta.originState = 'none';
    return originPathRejectResponse();
  }
  // 库路径在签名和回源之前失败关闭，不签发令牌。
  if (storedOriginPathUnsafe(sitePath)) {
    if (meta) meta.originState = 'none';
    return siteUnavailableResponse('origin-stored=reject');
  }
  // www（主站）保持原路径：不加超时/重试，异常仍按原逻辑处理。
  if (isWwwRequest(u)) return rewriteOriginOnce(req, event, u, originPath, sitePath, originHost, meta, false);
  try {
    return await rewriteOriginOnce(req, event, u, originPath, sitePath, originHost, meta, true);
  } catch (e) {
    try { console.warn('[subdomain-router] origin fetch failed for', u.hostname, (e && e.message) || e); } catch (err) {}
    if (meta) meta.originState = 'error';
    return siteUnavailableResponse();
  }
}

function envString(name) {
  try {
    if (typeof env !== 'undefined' && env && env[name]) return String(env[name]);
  } catch (e) {}
  return '';
}

// DEMOX_TEST_HOST_MAP 只在测试函数上设置。生产不设，下面的解析结果是 null，
// 缓存前缀、回源主机、响应头都保持原样。
// 值是 JSON：物理主机 → 逻辑主机，例如 "k2t-www.demox.site": "www.demox.site"。
// 键必须是 k2t(-[a-z0-9]+)*.demox.site。值只能是 demox.site、www.demox.site、
// sites.demox.site，或单个用户站标签（不要 api、site-N、k2t-*、sites-*）。
// 空表、非对象、任一键或值不合格：整张表作废，当成没设。不换缓存前缀，不全站 599。
// 分类用逻辑主机。回源 URL 和 301 目标用物理主机。不重建入站 Request，不改它的 Host。
var testHostMapState = null;
var testHostMapReady = false;
var testHostUnmappedWarned = false;
var testHostMapRejectedWarned = false;
var TEST_HOST_MAP_KEY_RE = /^k2t(-[a-z0-9]+)*\.demox\.site$/;

function normalizeHostName(value) {
  return String(value || '').trim().toLowerCase().replace(/\.+$/, '');
}

function testHostMapValueOk(value) {
  if (value === 'demox.site' || value === 'www.demox.site' || value === 'sites.demox.site') return true;
  const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.demox\.site$/.exec(value);
  if (!match) return false;
  const label = match[1];
  if (label === 'www' || label === 'sites' || label === 'api' || label === 'demox') return false;
  if (label.indexOf('k2t-') === 0 || label.indexOf('sites-') === 0) return false;
  if (/^site-\d+$/.test(label)) return false;
  return true;
}

function warnTestHostMapRejected() {
  if (testHostMapRejectedWarned) return;
  testHostMapRejectedWarned = true;
  try { console.warn('[subdomain-router] test host map rejected'); } catch (e) {}
}

function warnUnmappedTestHost() {
  if (testHostUnmappedWarned) return;
  testHostUnmappedWarned = true;
  try { console.warn('[subdomain-router] unmapped test host'); } catch (e) {}
}

function rejectTestHostMap() {
  warnTestHostMapRejected();
  testHostMapState = null;
  return null;
}

function testHostMap() {
  if (testHostMapReady) return testHostMapState;
  testHostMapReady = true;
  const raw = envString('DEMOX_TEST_HOST_MAP').trim();
  if (!raw) {
    testHostMapState = null;
    return null;
  }
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return rejectTestHostMap();
  const keys = Object.keys(parsed);
  if (!keys.length) return rejectTestHostMap();
  const map = Object.create(null);
  for (let i = 0; i < keys.length; i += 1) {
    const physical = String(keys[i] || '').trim().toLowerCase();
    const logical = String(parsed[keys[i]] == null ? '' : parsed[keys[i]]).trim().toLowerCase();
    if (!TEST_HOST_MAP_KEY_RE.test(physical) || !testHostMapValueOk(logical)) return rejectTestHostMap();
    map[physical] = logical;
  }
  testHostMapState = map;
  // 节点上的 caches.default 被所有函数共享。映射打开时换前缀，避免读到生产条目。
  RESOLVE_CACHE_PREFIX = 'https://resolve-k2test.demox.site/v2/';
  RESOLVE_LEGACY_CACHE_PREFIX = 'https://resolve-k2test.demox.site/';
  return map;
}

function testHostMapActive() {
  return testHostMap() !== null;
}

function logicalHostName(hostname) {
  const raw = String(hostname || '').trim().toLowerCase();
  const map = testHostMap();
  // 映射没打开时保留 URL 上的尾点，跟生产一致：demox.site. 不是 apex 301，
  // www.demox.site. 不走主站自定义 404。只在查表前去掉尾点。
  if (!map) return raw;
  const name = raw.replace(/\.+$/, '');
  return map[name] || name;
}

function physicalHostName(logical) {
  const name = normalizeHostName(logical);
  const map = testHostMap();
  if (!map) return name;
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i += 1) {
    if (map[keys[i]] === name) return keys[i];
  }
  return name;
}

function physicalOriginHost(originHost) {
  return physicalHostName(originHost || 'sites.demox.site');
}

function isDemoxZoneHost(hostname) {
  const name = normalizeHostName(hostname);
  return name === 'demox.site' || name.endsWith('.demox.site');
}

function isTestHostExempt(hostname) {
  const name = normalizeHostName(hostname);
  if (name === 'api.demox.site') return true;
  return /^site-\d+\.demox\.site$/.test(name);
}

function unmappedTestHostResponse() {
  warnUnmappedTestHost();
  return new Response('unmapped-host', {
    status: 599,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'x-demox-route': 'test-host=unmapped',
      'x-demox-env': 'nonprod'
    }
  });
}

function stampTestEnv(resp) {
  if (!testHostMapActive() || !resp) return resp;
  try {
    resp.headers.set('x-demox-env', 'nonprod');
    return resp;
  } catch (e) {
    try {
      const copy = new Response(resp.body, resp);
      copy.headers.set('x-demox-env', 'nonprod');
      return copy;
    } catch (err) {
      return resp;
    }
  }
}

function secretIsConfigured(value) {
  const text = String(value || '');
  if (!text) return false;
  try {
    if (typeof TextEncoder !== 'function') return false;
    return new TextEncoder().encode(text).length >= ORIGIN_GUARD_MIN_SECRET_BYTES;
  } catch (e) {
    return false;
  }
}

function originGuardSecret(slot) {
  if (slot !== 'A' && slot !== 'B') return '';
  const name = ORIGIN_GUARD_SECRET_SLOTS[slot];
  if (!name) return '';
  const value = envString(name);
  return secretIsConfigured(value) ? value : '';
}

// 每个 isolate 只打一次。文案是常量，不拼接槽名、KID、密钥或令牌。
var originGuardSigningWarned = false;
var originGuardAttachWarned = false;

function warnOriginGuardSigningOnce() {
  if (originGuardSigningWarned) return;
  originGuardSigningWarned = true;
  try {
    console.warn('[subdomain-router] origin guard signing unavailable');
  } catch (e) {}
}

function warnOriginGuardAttachOnce() {
  if (originGuardAttachWarned) return;
  originGuardAttachWarned = true;
  try {
    console.warn('[subdomain-router] origin guard token was not attached');
  } catch (e) {}
}

function originGuardSigningSlot() {
  const kid = envString(ORIGIN_GUARD_KID_ENV).trim();
  const kidOk = kid === 'A' || kid === 'B';
  if (!kidOk || !originGuardSecret(kid)) {
    warnOriginGuardSigningOnce();
    return '';
  }
  return kid;
}

function originTokenMessage(exp, method, host, pathname, search, kid) {
  return [
    'v1',
    String(kid || ''),
    String(exp),
    String(method || 'GET').toUpperCase(),
    String(host || '').toLowerCase(),
    String(pathname || ''),
    String(search || '')
  ].join('\n');
}

function bytesToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  }
  return out;
}

function timingSafeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  const max = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < max; i += 1) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

var originHmacKeys = Object.create(null);

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  let key = originHmacKeys[secret];
  if (!key) {
    key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    originHmacKeys[secret] = key;
  }
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToHex(sig);
}

// 短时 HMAC。只在 KID 点名的槽已配置（≥32 字节）且运行时有 Web Crypto 时签发。
async function signOriginInternalToken(method, host, pathname, search) {
  const kid = originGuardSigningSlot();
  const secret = kid ? originGuardSecret(kid) : '';
  if (!secret) return '';
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle || typeof TextEncoder !== 'function') return '';
    const exp = nowMs() + ORIGIN_INTERNAL_TOKEN_TTL_MS;
    const mac = await hmacSha256Hex(secret, originTokenMessage(exp, method, host, pathname, search, kid));
    return 'v1.' + kid + '.' + String(exp) + '.' + mac;
  } catch (e) {
    warnOriginGuardAttachOnce();
    return '';
  }
}

// 校验失败一律当外部请求。没有令牌头就不做 HMAC。两个槽按令牌里的 kid 取密钥。
// 密钥为空或短于 32 字节时任何头都失败，守卫照常执行。
async function verifyOriginInternalToken(req, host) {
  const presented = String((req.headers && req.headers.get(ORIGIN_INTERNAL_TOKEN_HEADER)) || '');
  if (!presented) return false;
  const parts = presented.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const kid = parts[1];
  const expRaw = parts[2];
  const mac = parts[3];
  if (kid !== 'A' && kid !== 'B') return false;
  const secret = originGuardSecret(kid);
  if (!secret) return false;
  let pathname = '';
  let search = '';
  let method = 'GET';
  try {
    const u = new URL(req.url);
    pathname = u.pathname;
    search = u.search;
    method = req.method || 'GET';
  } catch (e) {}
  const exp = /^\d{1,16}$/.test(expRaw) ? Number(expRaw) : 0;
  let expected = '';
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder === 'function') {
      expected = await hmacSha256Hex(secret, originTokenMessage(exp || 0, method, host, pathname, search, kid));
    }
  } catch (e) {
    expected = '';
  }
  const macOk = !!(expected && timingSafeEqual(expected, mac));
  const now = nowMs();
  const skew = ORIGIN_TOKEN_CLOCK_SKEW_MS;
  const fresh = exp + skew > now && exp <= now + ORIGIN_INTERNAL_TOKEN_TTL_MS + skew;
  return macOk && fresh;
}

// 只删除令牌头，保留 Host。
// 这里的 URL 已经是源站 host，Host 与 URL host 一致。EdgeOne 只写明了一种不再进入函数的子请求：
// URL host 和 Host 头都跟客户端请求一致。删掉 Host 会离开这个条件，可能造成第二次进入。
// 没有令牌时原样返回，避免无谓地重建请求。
// 跨 host 回源（访客 Host → sites / site-N）仍在 attachOriginToken 里去掉 Host，否则 COS 会 400 UserCnameInvalid。
function stripOriginInternalToken(req) {
  if (!req.headers || !req.headers.has(ORIGIN_INTERNAL_TOKEN_HEADER)) return req;
  const headers = new Headers(req.headers);
  headers.delete(ORIGIN_INTERNAL_TOKEN_HEADER);
  const method = req.method || 'GET';
  const init = { method: method, headers: headers, redirect: 'manual' };
  if (method !== 'GET' && method !== 'HEAD' && req.body != null) init.body = req.body;
  const targetUrl = req.url;
  return new Request(targetUrl, init);
}

// www 签过名的子请求只带源站需要的头，外加内部令牌。
// 不复制 Host：URL 是 sites.demox.site，Host 仍是 www.demox.site 时，EdgeOne 按 Host 把子请求送回 www，
// CDN-Loop 加到 16 后节点自己回 423（函数里没有 423）。也不复制逐跳头、eo-*、x-forwarded-*、cdn-loop、
// Cookie、Authorization、Proxy-Authorization。不因为 Host 是 www 就免裁决。
// range 和 if-* 只跟主文档那一次回源。SPA 的 index.html 和 404.html 再带上它们时，
// Range 会把整页收成 206 片段，If-None-Match 会把仍有效的路由收成 304/404。
var WWW_SIGNED_DOCUMENT_HEADERS = [
  'accept',
  'accept-encoding',
  'accept-language',
  'user-agent'
];
var WWW_SIGNED_CONDITIONAL_HEADERS = [
  'range',
  'if-none-match',
  'if-modified-since'
];
var WWW_SIGNED_REQUEST_HEADERS = WWW_SIGNED_DOCUMENT_HEADERS.concat(WWW_SIGNED_CONDITIONAL_HEADERS);
var ORIGIN_SIGN_HEADER = 'x-demox-origin-sign';
var originSignByRequest = typeof WeakMap === 'function' ? new WeakMap() : null;

function noteOriginSign(req, sign) {
  if (!originSignByRequest || !req) return;
  if (sign !== 'signed' && sign !== 'no-slot' && sign !== 'sign-failed') return;
  originSignByRequest.set(req, sign);
}

function readOriginSign(req) {
  if (!originSignByRequest || !req) return '';
  return originSignByRequest.get(req) || '';
}

function stampOriginSign(resp, req) {
  const sign = readOriginSign(req);
  if (sign !== 'signed' && sign !== 'no-slot' && sign !== 'sign-failed') return resp;
  if (!resp) return resp;
  try {
    resp.headers.set(ORIGIN_SIGN_HEADER, sign);
    return resp;
  } catch (e) {
    try {
      const copy = new Response(resp.body, resp);
      copy.headers.set(ORIGIN_SIGN_HEADER, sign);
      return copy;
    } catch (err) {
      return resp;
    }
  }
}

function signedWwwHeaders(source, token, includeConditional) {
  const names = includeConditional ? WWW_SIGNED_REQUEST_HEADERS : WWW_SIGNED_DOCUMENT_HEADERS;
  const headers = new Headers();
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    if (!includeConditional && (name === 'range' || name.indexOf('if-') === 0)) continue;
    let value = '';
    try {
      if (source && typeof source.get === 'function') value = source.get(name) || '';
    } catch (e) {
      value = '';
    }
    if (!value) continue;
    headers.set(name, value);
  }
  headers.set(ORIGIN_INTERNAL_TOKEN_HEADER, token);
  return headers;
}

async function signedWwwInit(req, url, method, includeConditional) {
  if (!originGuardSigningSlot()) {
    noteOriginSign(req, 'no-slot');
    return null;
  }
  const verb = method || (req && req.method) || 'GET';
  let target;
  try { target = new URL(url); } catch (e) {
    warnOriginGuardAttachOnce();
    noteOriginSign(req, 'sign-failed');
    return null;
  }
  // site-N 今天是 http。令牌不要出现在明文链路上。
  if (target.protocol !== 'https:') {
    noteOriginSign(req, 'sign-failed');
    return null;
  }
  const token = await signOriginInternalToken(verb, target.hostname, target.pathname, target.search);
  if (!token) {
    warnOriginGuardAttachOnce();
    noteOriginSign(req, 'sign-failed');
    return null;
  }
  try {
    const headers = signedWwwHeaders(req && req.headers, token, includeConditional !== false);
    noteOriginSign(req, 'signed');
    return { method: verb, headers: headers };
  } catch (e) {
    warnOriginGuardAttachOnce();
    noteOriginSign(req, 'sign-failed');
    return null;
  }
}

// 密钥未配置时返回原来的 init（通常就是 req），fetch(url, req) 保持不变。
async function attachOriginToken(url, init) {
  let method = 'GET';
  if (init && typeof init === 'object' && init.method) method = init.method;
  let target;
  try { target = new URL(url); } catch (e) { return init; }
  // 明文 http（site-N）不带令牌。跨 host 仍删除 Host，避免把访客 Host 带到 COS。
  if (target.protocol !== 'https:') return init;
  const token = await signOriginInternalToken(method, target.hostname, target.pathname, target.search);
  if (!token) return init;
  const headers = new Headers((init && init.headers) || {});
  headers.set(ORIGIN_INTERNAL_TOKEN_HEADER, token);
  headers.delete('host');
  const next = { method: method, headers: headers, redirect: 'manual' };
  if (init && init.body != null && method !== 'GET' && method !== 'HEAD') next.body = init.body;
  return next;
}

async function rewriteOriginOnce(req, event, u, originPath, sitePath, originHost, meta, hardened) {
  const originFetch = hardened
    ? function (url, init) { return fetchSiteOrigin(url, init, meta); }
    : function (url, init) { return fetch(url, init); };
  // 没有签名槽时 www 仍把入站 req 交给 originFetch（#49 的调用形状）。
  // 有签名槽时用白名单 Headers（不含 Host），不改入站头。
  // 主文档保留 range / if-*。SPA 的 index.html 不带这两类头。404.html 在 serveCustom404 里签，同样不带。
  // 都不按 Host 免裁决。
  const pageUrl = buildOriginUrl(req, originPath, u.search, originHost);
  const signedPage = !hardened ? await signedWwwInit(req, pageUrl, undefined, true) : null;
  const resp = signedPage
    ? await originFetch(pageUrl, signedPage)
    : await originFetch(buildOriginUrl(req, originPath, u.search, originHost), req);
  if (resp.status === 404 && sitePath && shouldFallbackToIndex(req, originPath)) {
    // The Demox main site has a finite client-route surface. Unknown document
    // paths must remain real 404s instead of becoming indexable soft 404s.
    if (isWwwRequest(u) && !isWwwSpaRoute(u.pathname)) {
      return serveCustom404(req, event, u, sitePath, originHost, meta);
    }
    const indexUrl = buildOriginUrl(req, `/${sitePath}/index.html`, '', originHost);
    const signedIndex = !hardened ? await signedWwwInit(req, indexUrl, 'GET', false) : null;
    const idxResp = signedIndex
      ? await originFetch(indexUrl, signedIndex)
      : await originFetch(buildOriginUrl(req, `/${sitePath}/index.html`, '', originHost), { method: 'GET' });
    if (idxResp.ok) {
      // SPA 入口用 200 返回，浏览器交给前端路由渲染(等同站点独占桶根的 fallback 行为)
      const headers = applySiteCacheHeaders({ 'Content-Type': 'text/html; charset=utf-8' }, meta);
      const route = idxResp.headers.get('x-demox-route');
      if (route) headers.set('x-demox-route', route);
      return stampOriginSign(await withDemoxBadge(req, event, new Response(idxResp.body, {
        status: 200,
        headers: headers
      }), meta), req);
    }
    // index.html 不存在 → 尝试站点自定义 404.html，再兜底 Demox 默认 404
    return serveCustom404(req, event, u, sitePath, originHost, meta);
  }
  return stampOriginSign(await withDemoxBadge(req, event, resp, meta), req);
}

async function custom404Document(custom404, meta) {
  const html = await custom404.text();
  const headers = new Headers(custom404.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  applySiteCacheHeaders(headers, meta, 404);
  // 正文已经按文本读出。留下源站的 content-encoding / 压缩前的 content-length 会让浏览器把明文当 gzip。
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(html, { status: 404, headers });
}

/**
 * 404 处理：优先返回站点自定义 404.html，不存在则返回 Demox 默认 404 页面。
 * 保持 HTTP 404 状态码（SEO 友好）；仅对页面导航请求生效。
 */
async function serveCustom404(req, event, u, sitePath, originHost, meta) {
  // 1) 尝试站点的 404.html。www 在有签名槽时用新的 Headers 带上内部令牌。
  // 没有签名槽，以及用户站，仍走下面那条 #49 之前的 GET。有令牌的响应不再补一条无令牌请求。
  if (sitePath) {
    try {
      let skipUnsigned = false;
      if (isWwwRequest(u)) {
        const missingUrl = buildOriginUrl(req, `/${sitePath}/404.html`, '', originHost);
        const signed = await signedWwwInit(req, missingUrl, 'GET', false);
        if (signed) {
          skipUnsigned = true;
          const custom404 = await fetch(missingUrl, signed);
          if (custom404.ok) return stampOriginSign(await custom404Document(custom404, meta), req);
        }
      }
      if (!skipUnsigned) {
        const custom404 = await fetch(buildOriginUrl(req, `/${sitePath}/404.html`, '', originHost), { method: 'GET' });
        if (custom404.ok) return stampOriginSign(await custom404Document(custom404, meta), req);
      }
    } catch (e) {}
  }
  // 2) 兜底：Demox 默认 404 页面
  const html = getDefault404Html(meta, u);
  return stampOriginSign(new Response(html, {
    status: 404,
    headers: applySiteCacheHeaders({ 'Content-Type': 'text/html; charset=utf-8' }, meta, 404)
  }), req);
}

/**
 * Demox 默认 404 页面：暗色主题，显示站点名 + 返回首页链接 + Demox 品牌。
 */
function getDefault404Html(meta, u) {
  const siteName = (meta && meta.seo && meta.seo.title) || (meta && meta.label) || 'This site';
  const homeUrl = (u && u.origin) || '/';
  const escapedName = String(siteName).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>404 - Page Not Found</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e4e4e7; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .container { text-align: center; padding: 2rem; max-width: 480px; }
  .code { font-size: 6rem; font-weight: 800; color: #18181b; text-shadow: 0 0 40px rgba(255,255,255,0.05); letter-spacing: -0.05em; }
  .title { font-size: 1.25rem; font-weight: 600; margin: 0.5rem 0 0.75rem; color: #f4f4f5; }
  .desc { font-size: 0.875rem; color: #71717a; margin-bottom: 2rem; line-height: 1.6; }
  .desc .site { color: #a1a1aa; }
  .btn { display: inline-block; padding: 0.625rem 1.5rem; background: #f4f4f5; color: #09090b; border-radius: 0.5rem; text-decoration: none; font-size: 0.875rem; font-weight: 600; transition: background 0.15s; }
  .btn:hover { background: #e4e4e7; }
  .brand { margin-top: 2.5rem; font-size: 0.75rem; color: #52525b; }
  .brand a { color: #71717a; text-decoration: none; border-bottom: 1px solid #27272a; padding-bottom: 1px; }
  .brand a:hover { color: #a1a1aa; }
</style>
</head>
<body>
<div class="container">
  <div class="code">404</div>
  <h1 class="title">Page Not Found</h1>
  <p class="desc">The page you're looking for doesn't exist.<br><span class="site">${escapedName}</span></p>
  <a href="${homeUrl}" class="btn">&larr; Back to Home</a>
  <div class="brand">Published with <a href="https://www.demox.site">Demox</a></div>
</div>
</body>
</html>`;
}

// 站点暂时不可用（回源失败 / 解析出错且无可用兜底）。no-store，绝不回落到桶根「站点未发布」。
function siteUnavailableResponse(route) {
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<meta name="robots" content="noindex, nofollow">' +
    '<title>暂时无法访问 · Temporarily unavailable</title>' +
    '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC",sans-serif;background:#fafafa;color:#18181b}' +
    'main{text-align:center;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#71717a;margin:.25rem 0}' +
    'a{color:#18181b}</style></head><body><main>' +
    '<h1>暂时无法访问，请刷新</h1><p>Temporarily unavailable, please refresh.</p>' +
    '<p><a href="javascript:location.reload()">刷新 / Refresh</a></p></main></body></html>';
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Retry-After': String(SITE_UNAVAILABLE_RETRY_AFTER)
  };
  if (route) headers['x-demox-route'] = route;
  return new Response(html, { status: 503, headers: headers });
}

function withRouteHeader(resp, route) {
  if (!resp || !route) return resp;
  try {
    resp.headers.set('x-demox-route', route);
    return resp;
  } catch (e) {
    try {
      const copy = new Response(resp.body, resp);
      copy.headers.set('x-demox-route', route);
      return copy;
    } catch (err) {
      return resp;
    }
  }
}

// label 可能是用户站点（非 www / 非平台保留入口）。只有这类 host 在解析出错时回 503；
// 平台入口（如 sites.demox.site = www 回源域）保持原逻辑放行回源。
function isPossibleSiteLabel(label, domain, isCustomHost) {
  if (isCustomHost) return true;
  const l = String(label || '').toLowerCase();
  if (!l) return false;
  if (INFRA_LABELS.indexOf(l) !== -1) return false;
  if (l.indexOf('sites-') === 0) return false;
  return true;
}

function disabledSitePage() {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>站点已停用</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#0a0a0a; color:#e4e4e7; }
  .box { text-align:center; padding:2rem; max-width:28rem; }
  h1 { font-size:1.25rem; margin:0 0 .75rem; }
  p { color:#71717a; margin:0 0 1.5rem; }
  a { color:#a1a1aa; }
</style>
</head>
<body>
  <div class="box">
    <h1>此站点已被停用</h1>
    <p>该页面因举报审核被管理员关闭，暂不可访问。</p>
    <a href="https://www.demox.site/">Demox</a>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function shouldInjectDemoxBadge(req, resp) {
  const host = logicalHostName(new URL(req.url).hostname);
  if (host === WWW_HOST) return false;
  return shouldTrackSiteView(req, resp);
}

function shouldTrackSiteView(req, resp) {
  if (req.method !== 'GET' || resp.status !== 200) return false;
  const type = (resp.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('text/html')) return false;
  const disposition = (resp.headers.get('content-disposition') || '').toLowerCase();
  return !disposition.includes('attachment');
}

function getDemoxBadgeHtml(meta) {
  return `
<style data-demox-site-badge-style>
@media screen {
  div[${DEMOX_BADGE_MARKER}="wrap"] {
    position: fixed !important;
    left: max(14px, calc(env(safe-area-inset-left) + 12px)) !important;
    bottom: max(14px, calc(env(safe-area-inset-bottom) + 12px)) !important;
    z-index: 2147483647 !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: flex-start !important;
    gap: 6px !important;
    opacity: .94 !important;
    transition: opacity .18s ease !important;
  }
  div[${DEMOX_BADGE_MARKER}="wrap"].dragging {
    transition: none !important;
    opacity: 1 !important;
  }
  a[${DEMOX_BADGE_MARKER}="link"] {
    display: inline-flex !important;
    align-items: center !important;
    gap: 8px !important;
    min-height: 34px !important;
    padding: 8px 11px 8px 10px !important;
    border-radius: 999px !important;
    border: 1px solid rgba(255,255,255,.18) !important;
    background: linear-gradient(135deg, rgba(5,22,40,.9), rgba(8,78,82,.86)) !important;
    color: #f8fffb !important;
    box-shadow: 0 14px 34px rgba(2,12,27,.22), inset 0 1px 0 rgba(255,255,255,.18) !important;
    -webkit-backdrop-filter: blur(14px) saturate(1.12) !important;
    backdrop-filter: blur(14px) saturate(1.12) !important;
    font-family: "Avenir Next", "Trebuchet MS", "Gill Sans", sans-serif !important;
    font-size: 12px !important;
    font-weight: 700 !important;
    line-height: 1 !important;
    letter-spacing: .01em !important;
    text-decoration: none !important;
    text-transform: none !important;
    cursor: grab !important;
    touch-action: none !important;
    transition: transform .18s ease, box-shadow .18s ease !important;
  }
  a[${DEMOX_BADGE_MARKER}="link"]::before {
    content: "" !important;
    width: 9px !important;
    height: 9px !important;
    border-radius: 999px !important;
    background: radial-gradient(circle at 35% 30%, #ffffff 0 12%, #7df9d4 13% 48%, #2bb5ff 49% 100%) !important;
    box-shadow: 0 0 16px rgba(125,249,212,.72) !important;
    flex: 0 0 auto !important;
  }
  a[${DEMOX_BADGE_MARKER}="link"]:hover {
    box-shadow: 0 18px 40px rgba(2,12,27,.28), inset 0 1px 0 rgba(255,255,255,.2) !important;
  }
  a[${DEMOX_BADGE_MARKER}="link"]:focus-visible {
    outline: 3px solid rgba(125,249,212,.86) !important;
    outline-offset: 3px !important;
  }
  button[${DEMOX_BADGE_MARKER}="report"] {
    appearance: none !important;
    border: 0 !important;
    background: transparent !important;
    color: rgba(248,255,251,.7) !important;
    font-family: "Avenir Next", "Trebuchet MS", "Gill Sans", sans-serif !important;
    font-size: 11px !important;
    font-weight: 700 !important;
    letter-spacing: .04em !important;
    padding: 4px 8px 4px 10px !important;
    cursor: pointer !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
    text-shadow: 0 1px 8px rgba(0,0,0,.35) !important;
  }
  button[${DEMOX_BADGE_MARKER}="report"]:hover,
  button[${DEMOX_BADGE_MARKER}="report"][aria-expanded="true"] {
    color: #7df9d4 !important;
  }
  div[${DEMOX_BADGE_MARKER}="sheet"] {
    display: none !important;
    position: absolute !important;
    left: 0 !important;
    bottom: calc(100% + 8px) !important;
    width: min(292px, 82vw) !important;
    padding: 14px 14px 12px !important;
    border-radius: 18px !important;
    border: 1px solid rgba(255,255,255,.18) !important;
    background: linear-gradient(135deg, rgba(5,22,40,.94), rgba(8,78,82,.9)) !important;
    color: #f8fffb !important;
    box-shadow: 0 22px 50px rgba(2,12,27,.38), inset 0 1px 0 rgba(255,255,255,.16) !important;
    -webkit-backdrop-filter: blur(18px) saturate(1.14) !important;
    backdrop-filter: blur(18px) saturate(1.14) !important;
    font-family: "Avenir Next", "Trebuchet MS", "Gill Sans", sans-serif !important;
  }
  div[${DEMOX_BADGE_MARKER}="sheet"].open { display: block !important; }
  div[${DEMOX_BADGE_MARKER}="sheet"] h3 {
    margin: 0 !important; font-size: 14px !important; font-weight: 700 !important;
  }
  div[${DEMOX_BADGE_MARKER}="sheet"] .demox-report-sub {
    margin: 6px 0 12px !important; font-size: 11px !important; color: rgba(248,255,251,.62) !important; line-height: 1.45 !important;
  }
  div[${DEMOX_BADGE_MARKER}="sheet"] .demox-report-reasons {
    display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 6px !important;
  }
  div[${DEMOX_BADGE_MARKER}="sheet"] label {
    display: flex !important; align-items: center !important; gap: 6px !important;
    min-height: 32px !important; padding: 0 8px !important; border-radius: 10px !important;
    border: 1px solid rgba(255,255,255,.12) !important; font-size: 11px !important; cursor: pointer !important;
  }
  div[${DEMOX_BADGE_MARKER}="sheet"] textarea {
    width: 100% !important; margin: 8px 0 10px !important; min-height: 58px !important; resize: none !important;
    border-radius: 10px !important; border: 1px solid rgba(255,255,255,.12) !important;
    background: rgba(0,0,0,.18) !important; color: #f8fffb !important; padding: 8px !important;
    font: 12px/1.4 "Avenir Next", "Trebuchet MS", sans-serif !important;
  }
  div[${DEMOX_BADGE_MARKER}="sheet"] .demox-report-row { display: flex !important; gap: 8px !important; }
  div[${DEMOX_BADGE_MARKER}="sheet"] .demox-report-row button {
    flex: 1 !important; min-height: 34px !important; border-radius: 999px !important; border: 0 !important;
    cursor: pointer !important; font: 700 12px "Avenir Next", "Trebuchet MS", sans-serif !important;
  }
  div[${DEMOX_BADGE_MARKER}="sheet"] .demox-report-cancel { background: rgba(255,255,255,.08) !important; color: #f8fffb !important; }
  div[${DEMOX_BADGE_MARKER}="sheet"] .demox-report-send { background: #7df9d4 !important; color: #052018 !important; }
  div[${DEMOX_BADGE_MARKER}="done"] { display: none !important; font-size: 13px !important; padding: 18px 8px !important; text-align: center !important; }
  div[${DEMOX_BADGE_MARKER}="done"].show { display: block !important; }
  div[${DEMOX_BADGE_MARKER}="wrap"].dragging,
  div[${DEMOX_BADGE_MARKER}="wrap"].dragging a[${DEMOX_BADGE_MARKER}="link"] {
    cursor: grabbing !important;
    transform: none !important;
    user-select: none !important;
    -webkit-user-select: none !important;
  }
}
@media screen and (prefers-reduced-motion: no-preference) {
  div[${DEMOX_BADGE_MARKER}="wrap"]:not(.dragging) {
    animation: demoxBadgeRise .34s cubic-bezier(.2,.8,.2,1) both !important;
  }
  @keyframes demoxBadgeRise {
    from { opacity: 0; transform: translateY(8px) scale(.98); }
    to { opacity: .94; transform: translateY(0) scale(1); }
  }
}
@media print {
  div[${DEMOX_BADGE_MARKER}="wrap"] { display: none !important; }
}
</style>
<div ${DEMOX_BADGE_MARKER}="wrap">
  <div ${DEMOX_BADGE_MARKER}="sheet" role="dialog" aria-labelledby="demox-report-title">
    <form ${DEMOX_BADGE_MARKER}="form">
      <h3 id="demox-report-title">举报此站点</h3>
      <p class="demox-report-sub">我们会人工抽查。请选最接近的一类，可选填说明。</p>
      <div class="demox-report-reasons">
        <label><input type="radio" name="demox-report-reason" value="porn"> 色情低俗</label>
        <label><input type="radio" name="demox-report-reason" value="illegal"> 违法违规</label>
        <label><input type="radio" name="demox-report-reason" value="violence"> 暴力恐怖</label>
        <label><input type="radio" name="demox-report-reason" value="spam"> 欺诈广告</label>
        <label><input type="radio" name="demox-report-reason" value="ip"> 侵权盗用</label>
        <label><input type="radio" name="demox-report-reason" value="other" checked> 其他</label>
      </div>
      <textarea name="demox-report-note" maxlength="200" placeholder="可选：补充链接或说明（200 字内）"></textarea>
      <div class="demox-report-row">
        <button class="demox-report-cancel" type="button">取消</button>
        <button class="demox-report-send" type="submit">提交举报</button>
      </div>
    </form>
    <div ${DEMOX_BADGE_MARKER}="done">已收到，我们会尽快审核。</div>
  </div>
  <a ${DEMOX_BADGE_MARKER}="link" href="${demoxHomeUrl()}" target="_blank" rel="noopener noreferrer" aria-label="Go to Demox homepage">Powered by Demox</a>
  <button ${DEMOX_BADGE_MARKER}="report" type="button" aria-expanded="false">举报</button>
</div>
<script data-demox-site-badge-script>
(function () {
  var wrap = document.querySelector('div[${DEMOX_BADGE_MARKER}="wrap"]');
  if (!wrap) return;
  var link = wrap.querySelector('a[${DEMOX_BADGE_MARKER}="link"]');
  if (!link) return;
  var STORAGE_KEY = 'demox-badge-pos';
  var DRAG_THRESHOLD = 5;
  var ANALYTICS_URL = '${optionalBackendUrl('/website/analytics-track')}';
  var REPORT_URL = '${optionalBackendUrl('/website/report-site')}';
  var WEBSITE_ID = '${(meta && meta.websiteId) || ''}';
  var ANALYTICS_TOKEN = '';
  // 读取持久化位置：有则用 left/top 接管定位，无则保留 CSS 默认左下角
  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      wrap.style.left = saved.left + 'px';
      wrap.style.top = saved.top + 'px';
      wrap.style.bottom = 'auto';
      wrap.style.right = 'auto';
    }
  } catch (e) {}
  // 约束在 viewport 内
  function clamp(left, top) {
    var w = wrap.offsetWidth || 130, h = wrap.offsetHeight || 34;
    return {
      left: Math.max(0, Math.min(left, window.innerWidth - w)),
      top: Math.max(0, Math.min(top, window.innerHeight - h))
    };
  }
  function applyPos(left, top) {
    var c = clamp(left, top);
    wrap.style.left = c.left + 'px';
    wrap.style.top = c.top + 'px';
    wrap.style.bottom = 'auto';
    wrap.style.right = 'auto';
    return c;
  }
  var dragging = false, moved = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
  function getPoint(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }
  function onDown(e) {
    dragging = true; moved = false;
    var p = getPoint(e);
    startX = p.x; startY = p.y;
    var r = wrap.getBoundingClientRect();
    startLeft = r.left; startTop = r.top;
    wrap.classList.add('dragging');
    if (e.cancelable) e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    var p = getPoint(e);
    var dx = p.x - startX, dy = p.y - startY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) moved = true;
    applyPos(startLeft + dx, startTop + dy);
    if (e.cancelable) e.preventDefault();
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    wrap.classList.remove('dragging');
    if (moved) {
      var r = wrap.getBoundingClientRect();
      var c = applyPos(r.left, r.top);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch (e) {}
      // 拖动后阻止本次 click 跳转
      link.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); }, { capture: true, once: true });
    }
  }
  link.addEventListener('click', function () {
    if (!ANALYTICS_URL || !WEBSITE_ID) return;
    try {
      fetch(ANALYTICS_URL, {
        method: 'POST',
        mode: 'cors',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'track_site_event',
          websiteId: WEBSITE_ID,
          type: 'badge_click',
          host: location.hostname,
          path: location.pathname,
          referrer: document.referrer || '',
          country: 'UNKNOWN',
          province: 'UNKNOWN',
          userAgent: navigator.userAgent || '',
          analyticsToken: ANALYTICS_TOKEN
        })
      }).catch(function () {});
    } catch (e) {}
  });
  link.addEventListener('mousedown', onDown);
  link.addEventListener('touchstart', onDown, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchend', onUp);
  document.addEventListener('touchcancel', onUp);
  // 视口变化时把徽章拉回可见区
  window.addEventListener('resize', function () {
    var r = wrap.getBoundingClientRect();
    applyPos(r.left, r.top);
  });
  var reportBtn = wrap.querySelector('button[${DEMOX_BADGE_MARKER}="report"]');
  var sheet = wrap.querySelector('div[${DEMOX_BADGE_MARKER}="sheet"]');
  var form = wrap.querySelector('form[${DEMOX_BADGE_MARKER}="form"]');
  var done = wrap.querySelector('div[${DEMOX_BADGE_MARKER}="done"]');
  function setReportOpen(open) {
    if (!sheet || !reportBtn) return;
    if (open) {
      sheet.classList.add('open');
      reportBtn.setAttribute('aria-expanded', 'true');
      if (form) form.style.display = '';
      if (done) done.classList.remove('show');
    } else {
      sheet.classList.remove('open');
      reportBtn.setAttribute('aria-expanded', 'false');
    }
  }
  if (reportBtn && sheet) {
    reportBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setReportOpen(reportBtn.getAttribute('aria-expanded') !== 'true');
    });
    var cancel = sheet.querySelector('.demox-report-cancel');
    if (cancel) cancel.addEventListener('click', function () { setReportOpen(false); });
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var reasonEl = form.querySelector('input[name="demox-report-reason"]:checked');
        var noteEl = form.querySelector('textarea[name="demox-report-note"]');
        var payload = {
          action: 'report_site',
          websiteId: WEBSITE_ID,
          reason: reasonEl ? reasonEl.value : 'other',
          note: noteEl ? String(noteEl.value || '').slice(0, 200) : '',
          pageUrl: location.href,
          host: location.hostname,
          userAgent: navigator.userAgent || ''
        };
        if (REPORT_URL && WEBSITE_ID) {
          try {
            fetch(REPORT_URL, {
              method: 'POST',
              mode: 'cors',
              keepalive: true,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            }).catch(function () {});
          } catch (err) {}
        }
        if (form) form.style.display = 'none';
        if (done) done.classList.add('show');
        setTimeout(function () { setReportOpen(false); }, 1600);
      });
    }
  }
})();
</script>`;
}

function injectDemoxBadge(html, meta) {
  if (!html || html.indexOf(DEMOX_BADGE_MARKER) !== -1) return html;
  const badge = getDemoxBadgeHtml(meta);
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, function (match) {
      return badge + match;
    });
  }
  return html + badge;
}

function seoMetaKey(tag) {
  const property = String(tag).match(/\bproperty\s*=\s*["']([^"']+)["']/i);
  if (property) return property[1].toLowerCase();
  const name = String(tag).match(/\bname\s*=\s*["']([^"']+)["']/i);
  return name ? name[1].toLowerCase() : '';
}

/**
 * 向 <head> 注入 SEO meta 标签（title / description / og / twitter）。
 * 注入的标签带 data-demox-seo 属性，先移除旧注入再补新值，避免重复。
 * 用户配置了对应字段时，覆盖页面里已有的 title / description / og 标签，确保爬虫读到控制台设置。
 */
function injectSeoMeta(html, meta, pageUrl) {
  if (!html || !meta || !meta.seo) return html;
  const seo = meta.seo;
  if (!seo.title && !seo.description && !seo.ogImage) return html;

  html = html.replace(/<meta[^>]*data-demox-seo[^>]*>/gi, '');
  html = html.replace(/<title[^>]*data-demox-seo[^>]*>[\s\S]*?<\/title>/gi, '');
  if (seo.title) {
    html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '');
  }

  const drop = { 'og:type': true, 'og:url': true };
  if (seo.title) {
    drop['og:title'] = true;
    drop['twitter:title'] = true;
  }
  if (seo.description) {
    drop.description = true;
    drop['og:description'] = true;
    drop['twitter:description'] = true;
  }
  if (seo.ogImage) {
    drop['og:image'] = true;
    drop['twitter:image'] = true;
    drop['twitter:card'] = true;
  }
  html = html.replace(/<meta\b[^>]*>/gi, function (tag) {
    const key = seoMetaKey(tag);
    return key && drop[key] ? '' : tag;
  });

  const tags = [];
  if (seo.title) {
    tags.push('<title data-demox-seo>' + escapeHtml(seo.title) + '</title>');
    tags.push('<meta data-demox-seo property="og:title" content="' + escapeHtml(seo.title) + '">');
    tags.push('<meta data-demox-seo name="twitter:title" content="' + escapeHtml(seo.title) + '">');
  }
  if (seo.description) {
    tags.push('<meta data-demox-seo name="description" content="' + escapeHtml(seo.description) + '">');
    tags.push('<meta data-demox-seo property="og:description" content="' + escapeHtml(seo.description) + '">');
    tags.push('<meta data-demox-seo name="twitter:description" content="' + escapeHtml(seo.description) + '">');
  }
  if (seo.ogImage) {
    tags.push('<meta data-demox-seo property="og:image" content="' + escapeHtml(seo.ogImage) + '">');
    tags.push('<meta data-demox-seo name="twitter:image" content="' + escapeHtml(seo.ogImage) + '">');
    tags.push('<meta data-demox-seo name="twitter:card" content="summary_large_image">');
  }
  if (pageUrl) {
    tags.push('<meta data-demox-seo property="og:url" content="' + escapeHtml(pageUrl) + '">');
  }
  tags.push('<meta data-demox-seo property="og:type" content="website">');

  const block = tags.join('\n  ');
  if (/<\/head\s*>/i.test(html)) {
    return html.replace(/<\/head\s*>/i, function (match) {
      return '  ' + block + '\n' + match;
    });
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, function (match) {
      return match + '\n<head>\n  ' + block + '\n</head>';
    });
  }
  return '<head>\n  ' + block + '\n</head>' + html;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function htmlContentLength(resp) {
  const raw = resp && resp.headers ? resp.headers.get('content-length') : '';
  if (raw == null || String(raw).trim() === '') return null;
  const size = Number(raw);
  if (!Number.isFinite(size) || size < 0) return null;
  return size;
}

function streamSiteResponse(resp, meta) {
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: applySiteCacheHeaders(new Headers(resp.headers), meta, resp.status)
  });
}

async function withDemoxBadge(req, event, resp, meta) {
  if (shouldTrackSiteView(req, resp)) {
    trackSiteEvent(req, event, meta, 'view');
  }
  if (!shouldInjectDemoxBadge(req, resp)) {
    const current = (resp.headers.get('Cache-Control') || '').toLowerCase();
    const forceDownload = (resp.headers.get('x-cos-force-download') || '').toLowerCase() === 'true' ||
      (resp.headers.get('Content-Disposition') || '').toLowerCase().includes('attachment');
    const mustRewrite = (meta && meta.visibility === VISIBILITY_PRIVATE) ||
      forceDownload ||
      (isUncacheableStatus(resp.status) && current !== 'no-store') ||
      !current || current.includes('no-store') ||
      (current.includes('no-cache') && current.indexOf('max-age=') === -1);
    if (!mustRewrite) return resp;
    return streamSiteResponse(resp, meta);
  }
  const byteLength = htmlContentLength(resp);
  if (byteLength != null && byteLength >= MAX_BADGE_HTML_BYTES) {
    return streamSiteResponse(resp, meta);
  }
  let html;
  try {
    // 有长度且未超限时沿用原来的直接读取。长度缺失才 clone，OverSize 时还能返回未读的源站正文。
    html = byteLength == null ? await resp.clone().text() : await resp.text();
  } catch (e) {
    if (byteLength != null) throw e;
    return streamSiteResponse(resp, meta);
  }
  const headers = applySiteCacheHeaders(new Headers(resp.headers), meta, resp.status);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('etag');
  if (!(headers.get('content-type') || '').toLowerCase().includes('charset=')) {
    headers.set('content-type', 'text/html; charset=utf-8');
  }

  let pageUrl = '';
  try {
    const parsed = new URL(req.url);
    pageUrl = parsed.origin + parsed.pathname;
  } catch (e) {}
  let finalHtml = injectSeoMeta(html, meta, pageUrl);
  if (!(meta && meta.hideWatermark)) {
    finalHtml = injectDemoxBadge(finalHtml, meta);
  }

  return new Response(finalHtml, {
    status: resp.status,
    statusText: resp.statusText,
    headers
  });
}

function getCookie(req, name) {
  const raw = req.headers.get('cookie') || '';
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i].trim();
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    if (p.slice(0, eq) === name) {
      try {
        return decodeURIComponent(p.slice(eq + 1));
      } catch (e) {
        return p.slice(eq + 1);
      }
    }
  }
  return '';
}

function isDocumentRequest(req) {
  const destination = (req.headers.get('sec-fetch-dest') || '').toLowerCase();
  const accept = (req.headers.get('accept') || '').toLowerCase();
  return destination === 'document' || accept.includes('text/html');
}

function loginRequiredResponse() {
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function privateSiteLoginGate(req) {
  const next = new URL(req.url);
  const target = new URL('/site-auth', 'https://' + WWW_HOST);
  target.searchParams.set('next', next.toString());
  target.searchParams.set('embedded', '1');

  const host = escapeHtml(next.hostname);
  const frameUrl = escapeHtml(target.toString());
  // URL fragments never reach the edge, so the gate restores the browser's hash locally.
  const frameLoader = "(function(){var f=document.getElementById('demox-auth-frame');var u=new URL(f.dataset.src);var n=new URL(u.searchParams.get('next'));n.hash=window.location.hash;u.searchParams.set('next',n.toString());f.src=u.toString();})();";
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="robots" content="noindex,nofollow" />
  <title>登录后查看 ${host}</title>
  <style>
    :root { color-scheme: light dark; background: #e9e9e6; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { background: #e9e9e6; }
    .auth-frame { width: 100%; height: 100%; border: 0; }
    .fallback { position: fixed; inset: 0; display: grid; place-items: center; font: 14px sans-serif; }
    .fallback a { color: inherit; }
    @media (prefers-color-scheme: dark) { :root, body { background: #0d0d0d; color: #f5f5f5; } }
  </style>
</head>
<body>
  <iframe
    id="demox-auth-frame"
    class="auth-frame"
    data-src="${frameUrl}"
    title="登录 Demox 后查看私有项目"
    referrerpolicy="no-referrer"
    sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin allow-top-navigation"
  ></iframe>
  <script>${frameLoader}</script>
  <noscript><p class="fallback">需要启用 JavaScript，或<a href="${frameUrl}">前往登录</a>。</p></noscript>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-src https://" + WWW_HOST + "; script-src 'sha256-29k9IDwlfsUcc+yDMI+K34/rKJWIEVngWepmVWailgM='; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function completePrivateSiteLogin(req, label, domain) {
  const requestUrl = new URL(req.url);
  const sourceOrigin = (req.headers.get('origin') || '').toLowerCase();
  if (sourceOrigin !== ('https://' + WWW_HOST)) {
    return new Response('Invalid authentication origin', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  const contentType = (req.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return new Response('Unsupported authentication request', {
      status: 415,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  let rawBody = '';
  try {
    rawBody = await req.text();
  } catch (e) {
    return new Response('Invalid authentication request', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  if (rawBody.length > 32768) {
    return new Response('Authentication request too large', {
      status: 413,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  const params = new URLSearchParams(rawBody);
  const token = String(params.get('token') || '');
  const rawNext = String(params.get('next') || '');
  let next;
  try {
    next = new URL(rawNext);
  } catch (e) {
    next = null;
  }

  if (
    !token || token.length > 16384 || !next || next.protocol !== 'https:' ||
    next.origin !== requestUrl.origin || next.pathname === DEMOX_SITE_AUTH_COMPLETE_PATH
  ) {
    return new Response('Invalid authentication request', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  if (isOfficialDomain(domain)) return privateSiteReverifyResponse(req);
  const access = await checkPrivateSiteAccessToken(token, label, domain, requestUrl.hostname);
  const location = next.pathname + next.search + next.hash;
  if (!access.allowed) {
    if (!access.loginRequired) return accessDeniedPage(req);
    return new Response(null, {
      status: 303,
      headers: { Location: location, 'Cache-Control': 'no-store' }
    });
  }
  if (access.cookieScope === 'refuse') {
    return new Response('这个域名不能保存登录状态', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  const cookieHeader = customDomainAuthCookieHeader(requestUrl.hostname, token);
  if (!cookieHeader) {
    return new Response('这个域名不能保存登录状态', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  return new Response(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'no-store', 'Set-Cookie': cookieHeader }
  });
}

function privateSiteReverifyResponse(req) {
  if (!isDocumentRequest(req)) {
    return new Response('Re-verification required', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  const host = escapeHtml(new URL(req.url).hostname);
  const home = escapeHtml(demoxHomeUrl());
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="robots" content="noindex,nofollow" />
  <title>需要重新验证 - ${host}</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f5f2; color: #18181b;
      font: 15px/1.7 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
    main { width: min(88vw, 420px); padding: 32px; border: 1px solid rgba(24,24,27,.1); border-radius: 20px; background: #fff; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0; color: #52525b; }
    code { color: #18181b; }
    a { display: inline-block; margin-top: 20px; padding: 9px 16px; border-radius: 999px; background: #18181b; color: #fff; text-decoration: none; font-size: 14px; }
    @media (prefers-color-scheme: dark) { body { background: #0d0d0d; color: #f5f5f5; } main { background: #18181b; border-color: rgba(255,255,255,.1); } p { color: #a1a1aa; } code { color: #f5f5f5; } a { background: #f5f5f5; color: #18181b; } }
  </style>
</head>
<body>
  <main>
    <h1>需要重新验证</h1>
    <p><code>${host}</code> 是私有站点。为了账号安全，我们正在升级私有站点的验证方式，暂时无法打开，请稍后再试。</p>
    <a href="${home}">返回 Demox</a>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '3600',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function accessDeniedPage(req) {
  const host = new URL(req.url).hostname;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Access denied - Demox</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 20% 20%, rgba(45,212,191,.14), transparent 28rem),
        linear-gradient(135deg, #05070d, #101827 56%, #071512);
      color: #f8fafc;
      font-family: "Avenir Next", "Trebuchet MS", "Gill Sans", sans-serif;
    }
    main {
      width: min(92vw, 440px);
      padding: 34px;
      border: 1px solid rgba(148,163,184,.18);
      border-radius: 24px;
      background: rgba(2,6,23,.62);
      box-shadow: 0 24px 80px rgba(0,0,0,.36), inset 0 1px 0 rgba(255,255,255,.08);
      backdrop-filter: blur(18px);
      text-align: left;
    }
    .kicker {
      color: #7dd3fc;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    h1 {
      margin: 12px 0 10px;
      font-size: clamp(30px, 8vw, 48px);
      line-height: .95;
      letter-spacing: -.05em;
    }
    p {
      margin: 0;
      color: #94a3b8;
      line-height: 1.65;
      font-size: 15px;
    }
    a {
      display: inline-flex;
      margin-top: 24px;
      color: #020617;
      background: #f8fafc;
      border-radius: 999px;
      padding: 11px 15px;
      font-size: 13px;
      font-weight: 800;
      text-decoration: none;
    }
    code { color: #cbd5e1; }
  </style>
</head>
<body>
  <main>
    <div class="kicker">Private Demox site</div>
    <h1>Access denied</h1>
    <p>You are signed in, but your account does not have permission to view <code>${host}</code>.</p>
    <a href="${demoxHomeUrl()}">Go to Demox</a>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 403,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function checkPrivateSiteAccess(req, label, domain, host) {
  // 官方域名下的 demox_access 是旧前端写在父域上的账号令牌，不再认。
  if (isOfficialDomain(domain) && !host) return { allowed: false, loginRequired: true };
  const token = getCookie(req, DEMOX_AUTH_COOKIE);
  if (!token) return { allowed: false, loginRequired: true };

  return checkPrivateSiteAccessToken(token, label, domain, host);
}

async function checkPrivateSiteAccessToken(token, label, domain, host) {
  try {
    const payload = { action: 'check_site_access', label: label, domain: domain, token: token };
    if (host) payload.host = host;
    const resp = await fetch(backendUrl('/check-site-access'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) return { allowed: false, loginRequired: false };
    const data = await resp.json();
    return {
      allowed: !!(data && data.success && data.allowed),
      loginRequired: !!(data && data.loginRequired),
      cookieScope: (data && data.cookieScope) || ''
    };
  } catch (e) {
    return { allowed: false, loginRequired: false };
  }
}

/**
 * 路由解析：label+domain（或自定义域名 host）-> { path, websiteId, origin, visibility, hideWatermark, seo }。
 * path = 桶内路径前缀；origin = 该站点所属桶的回源域(多云)，为空时回退默认回源域。
 *
 * 边缘缓存规则（2026-10-08 修复「找不到」被长期缓存）：
 *   - 只有后端明确回答的结果才缓存：命中(found) 新鲜期 RESOLVE_CACHE_TTL 秒；
 *     确认不存在(not_found，含已删除) 和 已封禁(blocked，visibility=disabled) 只新鲜 RESOLVE_NEGATIVE_TTL 秒。
 *     not_found / blocked 写在同一个 key 上，覆盖掉之前的「正常」结果（写失败则删除该 key）。
 *   - 超时 / 网络异常 / 非 2xx / 后端报错(success:false 但不是 not found) 一律不写缓存。
 *     出错时：本节点缓存是 blocked → 继续返回停用页（fail closed）；
 *     是 found 且 visibility 不是 disabled、写入不超过 RESOLVE_STALE_IF_ERROR_TTL(10 分钟) → 兜底用它；
 *     否则按原逻辑走「站点不存在」分支（handle 里不变）。
 *   - 新鲜期写在缓存内容里(cachedAt)由代码判断，不再只依赖 Cache-Control：
 *     线上观测到旧 key 的条目远超 max-age=60 仍在（letters-from-the-hill 卡「找不到」~18h，
 *     example-essay 换前缀后仍能访问 ~18h）。
 *   - key 带版本前缀 RESOLVE_CACHE_PREFIX：发布新版本即绕开旧格式 key 上卡住的条目。
 *   - 单次查询 RESOLVE_TIMEOUT_MS 超时，最多 RESOLVE_ATTEMPTS 次。
 */
function nowMs() {
  return Date.now();
}

function emptyResolution() {
  return { path: null, websiteId: null, origin: null, visibility: 'public', hideWatermark: false, seo: null };
}

// 源站裁决把封禁、私有、uid 不符收成同一种拒绝，缓存里不留 owner / visibility 细节。
function blockedOriginResolution() {
  const resolution = emptyResolution();
  resolution.visibility = VISIBILITY_DISABLED;
  return resolution;
}

function resolutionFromData(j) {
  return {
    path: j && j.path ? j.path : null,
    websiteId: (j && j.websiteId) || null,
    origin: (j && j.origin) || null,
    visibility: (j && j.visibility) || 'public',
    hideWatermark: !!(j && j.hideWatermark),
    seo: (j && j.seo) || null
  };
}

function resolveSleep(ms) {
  if (!(ms > 0) || typeof setTimeout !== 'function') return Promise.resolve();
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// 后端「确实没有这个站点」的回答；其余 success:false 视为后端出错（如数据库异常），不缓存。
function isResolveNotFoundMessage(message) {
  const m = String(message || '').trim().toLowerCase();
  return RESOLVE_NOT_FOUND_MESSAGES.indexOf(m) !== -1;
}

// 单次查询：返回 { status: 'found' | 'blocked' | 'not_found' | 'error', resolution?, reason? }
// blocked = 后端确认站点存在但已被封禁(visibility=disabled)，是明确回答，不是错误。
async function resolveOnce(payload, signal) {
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
  if (signal) init.signal = signal;
  const resp = await fetch(backendUrl('/resolve-subdomain'), init);
  if (!resp || !resp.ok) {
    return { status: 'error', reason: 'http ' + (resp ? resp.status : 'none') };
  }
  const data = await resp.json();
  // K1 公开裁决：只有 allow。没有 websiteId 的旧响应没有这个字段，下面的逻辑不变。
  if (data && (data.allow === true || data.allow === false)) {
    const tainted = data.visibility === VISIBILITY_DISABLED || data.visibility === VISIBILITY_PRIVATE;
    if (data.allow === true && data.path && !tainted) {
      const resolution = resolutionFromData(data);
      resolution.visibility = 'public';
      return { status: 'found', resolution: resolution };
    }
    if (data.allow === false && data.reason === 'not_found' && !tainted) return { status: 'not_found' };
    if (data.allow === false || tainted) return { status: 'blocked', resolution: blockedOriginResolution() };
    return { status: 'error', reason: 'backend: incomplete allow verdict' };
  }
  if (data && data.success && data.path) {
    const resolution = resolutionFromData(data);
    if (resolution.visibility === VISIBILITY_DISABLED) return { status: 'blocked', resolution: resolution };
    return { status: 'found', resolution: resolution };
  }
  if (data && data.success) {
    return { status: 'not_found' };
  }
  if (data && isResolveNotFoundMessage(data.message)) {
    return { status: 'not_found' };
  }
  return { status: 'error', reason: 'backend: ' + String((data && data.message) || 'unknown').slice(0, 200) };
}

async function resolveOnceWithTimeout(payload, timeoutMs) {
  let controller = null;
  try {
    if (typeof AbortController === 'function') controller = new AbortController();
  } catch (e) {
    controller = null;
  }
  let timer = null;
  const attempt = resolveOnce(payload, controller ? controller.signal : null).catch(function (e) {
    return { status: 'error', reason: (e && (e.name || e.message)) || 'fetch failed' };
  });
  if (!(timeoutMs > 0) || typeof setTimeout !== 'function') return attempt;
  const timeout = new Promise(function (resolve) {
    timer = setTimeout(function () {
      try { if (controller) controller.abort(); } catch (e) {}
      resolve({ status: 'error', reason: 'timeout ' + timeoutMs + 'ms' });
    }, timeoutMs);
  });
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer);
  }
}

function isTransientResolveError(result) {
  const reason = String((result && result.reason) || '');
  if (reason.indexOf('backend:') === 0) return false;
  if (reason.indexOf('http 4') === 0) return false;
  return true;
}

async function lookupResolve(payload, options) {
  const opts = options || null;
  const budgetMs = opts && opts.budgetMs > 0 ? opts.budgetMs : 0;
  let result = { status: 'error', reason: 'no attempt' };
  if (!budgetMs) {
    const attempts = Math.max(1, RESOLVE_ATTEMPTS);
    for (let i = 0; i < attempts; i += 1) {
      if (i > 0) await resolveSleep(RESOLVE_RETRY_DELAY_MS);
      result = await resolveOnceWithTimeout(payload, RESOLVE_TIMEOUT_MS);
      if (result.status !== 'error') return result;
    }
    return result;
  }
  const deadline = nowMs() + budgetMs;
  const maxAttempts = Math.max(1, (opts && opts.maxAttempts) || 2);
  for (let i = 0; i < maxAttempts; i += 1) {
    if (i > 0) {
      if (!isTransientResolveError(result)) return result;
      const delay = opts && opts.retryDelayMs != null ? opts.retryDelayMs : ORIGIN_RESOLVE_RETRY_DELAY_MS;
      if (deadline - nowMs() <= delay + 15) break;
      await resolveSleep(delay);
    }
    const remaining = deadline - nowMs();
    if (remaining <= 15) {
      result = { status: 'error', reason: 'timeout budget' };
      break;
    }
    const timeoutMs = Math.min((opts && opts.attemptMs) || remaining, remaining);
    result = await resolveOnceWithTimeout(payload, timeoutMs);
    if (result.status !== 'error') return result;
  }
  return result;
}

async function readResolveCache(cache, cacheKey) {
  if (!cache) return null;
  try {
    const hit = await cache.match(cacheKey);
    if (!hit) return null;
    const j = await hit.json();
    if (!j || j.v !== RESOLVE_CACHE_VERSION || typeof j.cachedAt !== 'number') return null;
    if (j.status !== 'found' && j.status !== 'blocked' && j.status !== 'not_found') return null;
    return j;
  } catch (e) {
    // EdgeOne cache.match 对过期条目会抛 504，按未命中处理
    return null;
  }
}

function resolveEntryAgeMs(entry) {
  return nowMs() - entry.cachedAt;
}

function isResolveEntryFresh(entry, ttlByStatus) {
  const age = resolveEntryAgeMs(entry);
  const override = ttlByStatus && ttlByStatus[entry.status];
  const ttl = override != null ? override : (entry.status === 'found' ? RESOLVE_CACHE_TTL : RESOLVE_NEGATIVE_TTL);
  return age >= 0 && age < ttl * 1000;
}

// stale-if-error 只认「最近一次成功解析且可访问」的结果，最长 RESOLVE_STALE_IF_ERROR_TTL。
function isResolveEntryUsableAsStale(entry) {
  if (!entry || entry.status !== 'found' || !entry.data || !entry.data.path) return false;
  if (entry.data.visibility === VISIBILITY_DISABLED) return false;
  const age = resolveEntryAgeMs(entry);
  return age >= 0 && age < RESOLVE_STALE_IF_ERROR_TTL * 1000;
}

function resolutionFromEntry(entry) {
  return entry.status === 'not_found' ? emptyResolution() : resolutionFromData(entry.data);
}

async function writeResolveCache(cache, cacheKey, status, resolution, maxAgeOverride) {
  if (!cache) return;
  // found / blocked 的物理保留期 = stale-if-error 窗口（新鲜期由 cachedAt 在代码里判断）；
  // not_found 只保留 RESOLVE_NEGATIVE_TTL。by-ID 调用方传入 ≤60s 的 maxAgeOverride，不用这档 10 分钟。
  const maxAge = maxAgeOverride != null
    ? maxAgeOverride
    : (status === 'not_found' ? RESOLVE_NEGATIVE_TTL : RESOLVE_STALE_IF_ERROR_TTL);
  let written = false;
  try {
    const body = JSON.stringify({
      v: RESOLVE_CACHE_VERSION,
      status: status,
      cachedAt: nowMs(),
      data: status === 'not_found' ? null : resolution
    });
    await cache.put(cacheKey, new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=' + maxAge + ', s-maxage=' + maxAge
      }
    }));
    written = true;
  } catch (e) {}
  // 封禁 / 不存在没能覆盖写入时，至少删掉旧的「正常」结果，避免之后被 stale 兜底复活。
  if (!written && status !== 'found') {
    try { await cache.delete(cacheKey); } catch (e) {}
  }
}

function withResolveState(resolution, state) {
  resolution.resolveState = state;
  return resolution;
}

// 旧版本条目的年龄：只能从缓存响应的 Date / Age 头推断（旧代码没写时间戳）。推断不出来返回 null。
function legacyEntryAgeMs(resp) {
  let age = null;
  try {
    const date = resp.headers.get('date');
    const parsed = date ? Date.parse(date) : NaN;
    if (Number.isFinite(parsed)) age = nowMs() - parsed;
    const ageHeader = parseInt(resp.headers.get('age') || '', 10);
    if (Number.isFinite(ageHeader) && ageHeader >= 0) {
      age = age === null ? ageHeader * 1000 : Math.max(age, ageHeader * 1000);
    }
  } catch (e) {
    age = null;
  }
  return age;
}

// v1fallback：v2 没有条目且后端出错时读旧 key。
//   - 旧条目是封禁(visibility=disabled) → 按封禁处理（停用页，fail closed，不看年龄）
//   - 旧条目是「找不到」(path 为空) → 按不存在处理
//   - 旧条目是正常站点 → 只有能证明写入不超过 RESOLVE_STALE_IF_ERROR_TTL 才用（与 stale 规则一致），否则不用
// 返回 resolution 或 null（不可用）。
async function readLegacyFallback(cache, legacyKeyUrl) {
  if (!cache || !legacyKeyUrl) return null;
  try {
    const hit = await cache.match(new Request(legacyKeyUrl));
    if (!hit) return null;
    const ageMs = legacyEntryAgeMs(hit);
    const j = await hit.json();
    if (!j || typeof j !== 'object' || j.v !== undefined) return null;
    const resolution = resolutionFromData(j);
    if (!resolution.path) return emptyResolution();
    if (resolution.visibility === VISIBILITY_DISABLED) return resolution;
    if (ageMs !== null && ageMs >= 0 && ageMs < RESOLVE_STALE_IF_ERROR_TTL * 1000) return resolution;
    return null;
  } catch (e) {
    return null;
  }
}

// 返回 resolution，附 resolveState: 'hit' | 'miss' | 'stale' | 'v1fallback' | 'error'
async function cachedResolve(cacheKeyUrl, payload, logName, legacyKeyUrl, options) {
  const opts = options || null;
  const ttlByStatus = opts && opts.ttlByStatus;
  const maxAgeByStatus = opts && opts.maxAgeByStatus;
  const allowStale = !opts || opts.staleIfError !== false;
  const cacheKey = new Request(cacheKeyUrl);
  let cache = null;
  try { cache = caches.default; } catch (e) { cache = null; }

  const cached = await readResolveCache(cache, cacheKey);
  if (cached && isResolveEntryFresh(cached, ttlByStatus)) {
    return withResolveState(resolutionFromEntry(cached), 'hit');
  }

  const result = await lookupResolve(payload, opts);
  const maxAge = function (status) {
    return maxAgeByStatus && maxAgeByStatus[status] != null ? maxAgeByStatus[status] : undefined;
  };
  if (result.status === 'found' || result.status === 'blocked') {
    await writeResolveCache(cache, cacheKey, result.status, result.resolution, maxAge(result.status));
    return withResolveState(result.resolution, 'miss');
  }
  if (result.status === 'not_found') {
    await writeResolveCache(cache, cacheKey, 'not_found', null, maxAge('not_found'));
    return withResolveState(emptyResolution(), 'miss');
  }

  // by-ID：故障时只允许仍在新鲜期内的正缓存（上面已经返回）。过期条目和空缓存都拒绝，不回源。
  if (!allowStale) {
    try { console.warn('[subdomain-router] resolve failed closed for', logName, result.reason); } catch (e) {}
    return withResolveState(emptyResolution(), 'error');
  }

  // 出错：绝不缓存「找不到」。
  if (cached && cached.status === 'blocked') {
    // 已封禁的站点在后端出错时继续显示停用页（fail closed）
    return withResolveState(resolutionFromData(cached.data), 'stale');
  }
  if (cached && isResolveEntryUsableAsStale(cached)) {
    try { console.warn('[subdomain-router] resolve failed, serving stale route for', logName, result.reason); } catch (e) {}
    return withResolveState(resolutionFromData(cached.data), 'stale');
  }
  if (!cached) {
    const legacy = await readLegacyFallback(cache, legacyKeyUrl);
    if (legacy) {
      try { console.warn('[subdomain-router] resolve failed, using v1 entry for', logName, result.reason); } catch (e) {}
      return withResolveState(legacy, 'v1fallback');
    }
  }
  try { console.warn('[subdomain-router] resolve failed (not cached) for', logName, result.reason); } catch (e) {}
  return withResolveState(emptyResolution(), 'error');
}

function resolveSiteCacheKey(label, domain) {
  return RESOLVE_CACHE_PREFIX + 'host/' + encodeURIComponent(domain) + '/' + encodeURIComponent(label);
}

function resolveCustomHostCacheKey(hostname) {
  return RESOLVE_CACHE_PREFIX + 'custom/' + encodeURIComponent(hostname);
}

async function resolveCustomHost(host) {
  const hostname = String(host || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!hostname) return withResolveState(emptyResolution(), 'miss');
  return cachedResolve(
    resolveCustomHostCacheKey(hostname),
    { action: 'resolve_subdomain', host: hostname },
    hostname,
    RESOLVE_LEGACY_CACHE_PREFIX + 'custom/' + encodeURIComponent(hostname)
  );
}

async function resolveSite(label, domain) {
  const suffix = domain || DEFAULT_OFFICIAL_DOMAIN;
  return cachedResolve(
    resolveSiteCacheKey(label, suffix),
    { action: 'resolve_subdomain', subdomain: label, domain: suffix },
    label + '.' + suffix,
    RESOLVE_LEGACY_CACHE_PREFIX + 'host/' + encodeURIComponent(suffix) + '/' + encodeURIComponent(label)
  );
}

function resolveSiteByIdCacheKey(websiteId, uid) {
  return RESOLVE_CACHE_PREFIX + 'id/' + encodeURIComponent(String(websiteId || '').toUpperCase()) + '/' + encodeURIComponent(uid);
}

// 公开 resolve 端点，不带新凭证。允许与封禁的解析缓存 TTL 都是 15s，不用 10 分钟 stale。
// 这是 by-ID 裁决缓存，不是回源对象的 Cache-Control（那个只给客户端，见 ORIGIN_OBJECT_MAX_AGE）。
async function resolveSiteById(websiteId, uid) {
  // 允许结果不得超过封禁窗口，否则新封禁要等那条正缓存过期。
  const ttl = Math.min(ORIGIN_RESOLVE_FOUND_TTL, ORIGIN_RESOLVE_BAN_TTL);
  const negative = Math.min(ORIGIN_RESOLVE_NEGATIVE_TTL, ORIGIN_RESOLVE_BAN_TTL);
  return cachedResolve(
    resolveSiteByIdCacheKey(websiteId, uid),
    { action: 'resolve_subdomain', websiteId: websiteId, uid: uid },
    'id:' + websiteId,
    null,
    {
      ttlByStatus: { found: ttl, blocked: negative, not_found: negative },
      maxAgeByStatus: { found: ttl, blocked: negative, not_found: negative },
      staleIfError: false,
      budgetMs: ORIGIN_RESOLVE_BUDGET_MS,
      attemptMs: ORIGIN_RESOLVE_ATTEMPT_MS,
      maxAttempts: 2,
      retryDelayMs: ORIGIN_RESOLVE_RETRY_DELAY_MS
    }
  );
}

async function handle(req, event) {
  const ctx = { siteTraffic: false, resolveState: 'none' };
  const staleCookieDomain = hasAuthCookie(req.headers) ? officialDomainOfHost(new URL(req.url).hostname) : '';
  try {
    const resp = await handleRequest(req, event, ctx);
    const out = staleCookieDomain ? withExpiredAuthCookie(resp, staleCookieDomain) : resp;
    return stampTestEnv(out);
  } catch (e) {
    // 已确认是用户站点流量（非 www）时，任何意外异常都映射成 503，
    // 绝不让 passThroughOnException 回源到桶根返回「站点未发布」。
    if (ctx.siteTraffic) {
      try { console.warn('[subdomain-router] unexpected error on site traffic', (e && e.message) || e); } catch (err) {}
      const unavailable = siteUnavailableResponse('resolve=' + ctx.resolveState + '; origin=error');
      const out = staleCookieDomain ? withExpiredAuthCookie(unavailable, staleCookieDomain) : unavailable;
      return stampTestEnv(out);
    }
    throw e;
  }
}

function isOriginGuardHost(host) {
  const h = String(host || '').toLowerCase().replace(/\.+$/, '');
  if (ORIGIN_GUARD_HOSTS.indexOf(h) !== -1) return true;
  return ORIGIN_GUARD_HOST_RE.test(h);
}

// 路径里出现这些，一律拒绝：不查库、不签名、不回源。
// %2f %5c %2e %25 不区分大小写。单独的 %、截断的 %、非法十六进制、
// 过长 UTF-8 和非法 UTF-8（decodeURIComponent 抛错）同样拒绝。
// 解码后的 C0 控制字符和 DEL（%00、%01、%7F 等）也拒绝。
// 反斜杠、连续斜杠、. / .. 段同样拒绝。
function originPathUnsafe(pathname) {
  const path = String(pathname || '');
  if (/%(?:2f|5c|2e|25)/i.test(path)) return true;
  if (/%(?![0-9A-Fa-f]{2})/.test(path)) return true;
  if (path.indexOf('\\') !== -1) return true;
  if (path.indexOf('//') !== -1) return true;
  try {
    const decoded = decodeURIComponent(path);
    if (decoded.indexOf('\\') !== -1 || decoded.indexOf('%') !== -1) return true;
    if (/[\u0000-\u001f\u007f]/.test(decoded)) return true;
  } catch (e) {
    return true;
  }
  const segments = path.split('/');
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i] === '.' || segments[i] === '..') return true;
  }
  return false;
}

function originPathRejectResponse() {
  return new Response('Bad Request', {
    status: 400,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'x-demox-route': 'origin-path=reject'
    }
  });
}

// Unicode Cf（格式字符）。不用 \p{Cf}，避免边缘运行时不认 Unicode 属性转义导致整份脚本解析失败。
function isUnicodeFormatChar(cp) {
  return cp === 0xAD || cp === 0x61C || cp === 0x6DD || cp === 0x70F || cp === 0x8E2 ||
    cp === 0x180E || cp === 0xFEFF || cp === 0x110BD || cp === 0x110CD || cp === 0xE0001 ||
    (cp >= 0x600 && cp <= 0x605) ||
    (cp >= 0x890 && cp <= 0x891) ||
    (cp >= 0x200B && cp <= 0x200F) ||
    (cp >= 0x202A && cp <= 0x202E) ||
    (cp >= 0x2060 && cp <= 0x2064) ||
    (cp >= 0x2066 && cp <= 0x206F) ||
    (cp >= 0xFFF9 && cp <= 0xFFFB) ||
    (cp >= 0x13430 && cp <= 0x1343F) ||
    (cp >= 0x1BCA0 && cp <= 0x1BCA3) ||
    (cp >= 0x1D173 && cp <= 0x1D17A) ||
    (cp >= 0xE0020 && cp <= 0xE007F);
}

function stripUnicodeFormatChars(text) {
  const input = String(text || '');
  let out = '';
  for (let i = 0; i < input.length;) {
    const cp = input.codePointAt(i);
    const width = cp > 0xFFFF ? 2 : 1;
    if (!isUnicodeFormatChar(cp)) out += input.slice(i, i + width);
    i += width;
  }
  return out;
}

function segmentHasNonAscii(segment) {
  const text = String(segment || '');
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i);
    if (cp > 0x7F) return true;
    i += cp > 0xFFFF ? 2 : 1;
  }
  return false;
}

function firstDecodedSegment(text) {
  const segments = String(text || '').split('/');
  for (let j = 0; j < segments.length; j += 1) {
    if (!segments[j]) continue;
    return segments[j].trim();
  }
  return '';
}

// 透传前：百分号解码即 UTF-8 解码，失败返回 'reject'（调用方 400，不回源）。
// 成功后先去掉 Cf（零宽空格、软连字符、BOM 等）。第一段去掉空白后若仍含非 ASCII，
// 在 NFKC 之前就交给守卫。数学粗体 s（U+1D42C）加 "sites" 经 NFKC 会折成 "ssites"，
// 折完再查就不再以 sites 开头，也会变成纯 ASCII。Cf 必须先去掉，否则零宽空格加 assets 会被误判。
// 只剩 ASCII 时再 NFKC、小写；第一段以 sites 开头也交给守卫。
function classifyPassthroughOriginPath(pathname) {
  const raw = String(pathname || '');
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch (e) {
    return 'reject';
  }
  const stripped = stripUnicodeFormatChars(decoded);
  if (segmentHasNonAscii(firstDecodedSegment(stripped))) return 'sites';
  let text = stripped;
  try { text = text.normalize('NFKC'); } catch (err) {}
  text = text.toLowerCase();
  if (firstDecodedSegment(text).indexOf('sites') === 0) return 'sites';
  return 'pass';
}

// /sites/<uid>/<ID> 没有尾斜杠也算命中：裁决通过后 308 到带斜杠的地址，绝不原样放行。
// 非法编码或 uid 不符合 ^[A-Za-z0-9_-]{1,64}$ 时返回 { reject: true }，调用方不得查库。
function parseOriginSitePath(pathname) {
  const path = String(pathname || '');
  if (originPathUnsafe(path)) return { reject: true };
  const matched = path.match(/^\/sites\/([^/]+)\/([A-Za-z0-9]+)(\/.*)?$/);
  if (!matched) return null;
  const uid = matched[1];
  const websiteId = matched[2];
  if (!ORIGIN_UID_RE.test(uid)) return { reject: true };
  if (!websiteId || websiteId.length > 64) return { reject: true };
  return { uid: uid, websiteId: websiteId, needsSlash: matched[3] == null };
}

function isOriginAllowlisted(pathname) {
  const path = String(pathname || '');
  for (let i = 0; i < ORIGIN_GUARD_ALLOWLIST.length; i += 1) {
    if (ORIGIN_GUARD_ALLOWLIST[i] && ORIGIN_GUARD_ALLOWLIST[i].path === path) return true;
  }
  return false;
}

function originReturnedPathMatches(parsed, resolutionPath) {
  const prefix = 'sites/' + parsed.uid + '/' + parsed.websiteId;
  const got = String(resolutionPath || '').replace(/^\/+/, '');
  return got === prefix || got.indexOf(prefix + '/') === 0;
}

function originGuardDeniedPage() {
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    '<title>无法访问</title></head><body>' +
    '<h1>无法访问</h1><p>This page is not available.</p></body></html>';
  return new Response(html, {
    status: 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function originGuardForbidden(route) {
  return new Response('Forbidden', {
    status: 403,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'x-demox-route': route || 'origin-guard=deny'
    }
  });
}

function originGuardNotFound() {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'x-demox-route': 'origin-guard=not-found'
    }
  });
}

// 放行对象的 Cache-Control 用 ORIGIN_OBJECT_MAX_AGE。这个 max-age 只影响客户端，
// 不改变 EdgeOne 节点缓存的 TTL。节点缓存命中绕不过守卫，是因为函数先于节点缓存执行。
// 已经写进节点的 HIT 仍要在发布后 purge，这个头盖不住它们。
function capOriginObjectCache(resp, route) {
  if (!resp) return resp;
  try {
    const headers = new Headers(resp.headers);
    if (isUncacheableStatus(resp.status)) {
      headers.set('Cache-Control', 'no-store');
      headers.delete('Expires');
    } else {
      headers.set('Cache-Control', 'public, max-age=' + ORIGIN_OBJECT_MAX_AGE);
    }
    if (route) headers.set('x-demox-route', route);
    applyOriginObjectCors(headers, resp.status);
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: headers });
  } catch (e) {
    return resp;
  }
}

// 命中 *.demox.site 触发规则时，函数先于节点缓存执行，所以客户端的缓存 HIT 不能跳过这里的裁决。
// 这与对象上的 max-age 无关：max-age 只影响客户端，不改 EdgeOne 节点缓存 TTL。
// 同 host 且 Host 头仍在的 fetch 落在文档已写明的「不再进入函数」里。
// 跨 host 子请求会不会重入尚未证实，待用线上 EdgeOne 日志实测（EdgeFunctionSubrequest / ParentRequestID）。
var ORIGIN_GUARD_HOP_HEADER = 'x-demox-edge-hop';
var ORIGIN_GUARD_HOP_VALUE = 'guard';

function stampGuardHop(resp) {
  if (!resp) return resp;
  try {
    resp.headers.set(ORIGIN_GUARD_HOP_HEADER, ORIGIN_GUARD_HOP_VALUE);
    return resp;
  } catch (e) {
    try {
      const copy = new Response(resp.body, resp);
      copy.headers.set(ORIGIN_GUARD_HOP_HEADER, ORIGIN_GUARD_HOP_VALUE);
      return copy;
    } catch (err) {
      return resp;
    }
  }
}

async function handleOriginGuard(req, event, ctx, u, host) {
  return stampGuardHop(await originGuardDecision(req, event, ctx, u, host));
}

async function originGuardDecision(req, event, ctx, u, host) {
  ctx.siteTraffic = true;
  ctx.resolveState = 'origin';
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return originOptionsResponse();
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: {
        Allow: 'GET, HEAD',
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'x-demox-route': 'origin-guard=method'
      }
    });
  }
  if (await verifyOriginInternalToken(req, host)) {
    const stripped = stripOriginInternalToken(req);
    return capOriginObjectCache(await fetch(stripped), 'origin-guard=internal');
  }
  const parsed = parseOriginSitePath(u.pathname);
  if (parsed && parsed.reject) return originPathRejectResponse();
  if (!parsed) {
    if (isOriginAllowlisted(u.pathname)) {
      return capOriginObjectCache(await fetch(stripOriginInternalToken(req)), 'origin-guard=allowlist');
    }
    return originGuardForbidden('origin-guard=unparsed');
  }
  let resolution;
  try {
    resolution = await resolveSiteById(parsed.websiteId, parsed.uid);
  } catch (e) {
    return siteUnavailableResponse('origin-guard=error');
  }
  if (!resolution || resolution.resolveState === 'error') {
    return siteUnavailableResponse('origin-guard=error');
  }
  if (resolution.visibility === VISIBILITY_DISABLED || resolution.visibility === VISIBILITY_PRIVATE) {
    return withRouteHeader(originGuardDeniedPage(), 'origin-guard=blocked');
  }
  if (!resolution.path || !originReturnedPathMatches(parsed, resolution.path)) {
    return originGuardNotFound();
  }
  if (parsed.needsSlash) {
    return new Response(null, {
      status: 308,
      headers: {
        Location: u.pathname + '/' + u.search,
        'Cache-Control': 'no-store',
        'x-demox-route': 'origin-guard=slash'
      }
    });
  }
  const outbound = stripOriginInternalToken(req);
  return capOriginObjectCache(await fetch(outbound), 'origin-guard=allow');
}

function stripHostPort(host) {
  const value = String(host || '').trim();
  if (!value) return '';
  if (value.charAt(0) === '[') {
    const end = value.indexOf(']');
    return end === -1 ? value : value.slice(1, end);
  }
  const colon = value.lastIndexOf(':');
  if (colon > 0 && /^\d{1,5}$/.test(value.slice(colon + 1))) return value.slice(0, colon);
  return value;
}

function normalizeAuthorityHost(value) {
  return stripHostPort(value).toLowerCase().replace(/\.+$/, '');
}

// Host 头和 URL authority 不一致时拒绝。HTTP/2 上这是 Host 与 :authority 交叉。
// 缺 Host 头不算不一致（:authority 已经在 URL 里）。比较前小写并去掉尾点。
function requestHostMismatchesUrl(req, url) {
  let raw = '';
  try {
    raw = req && req.headers && req.headers.get ? (req.headers.get('host') || '') : '';
  } catch (e) {
    raw = '';
  }
  if (!raw) return false;
  const headerHost = normalizeAuthorityHost(raw);
  const urlHost = normalizeAuthorityHost(url && url.hostname);
  if (!headerHost || !urlHost) return false;
  return headerHost !== urlHost;
}

function originAuthorityMismatchResponse() {
  return new Response('Misdirected Request', {
    status: 421,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'x-demox-route': 'origin-guard=authority'
    }
  });
}

async function handleRequest(req, event, ctx) {
  const u = new URL(req.url);
  originGuardSigningSlot();
  // 令牌绑定请求 URL 的主机，尾点保留。映射未设时这和改映射之前一样。
  const urlHost = String(u.hostname || '').trim().toLowerCase();
  const lookupHost = urlHost.replace(/\.+$/, '');
  // 映射打开时，没列进表的 *.demox.site（api 和 site-N 除外）直接 599，不回源。
  // 查表前去掉尾点，所以 k2t-www.demox.site. 仍按 www。不改入站 Request。
  if (testHostMapActive() && isDemoxZoneHost(lookupHost) && !testHostMap()[lookupHost] && !isTestHostExempt(lookupHost)) {
    return unmappedTestHostResponse();
  }
  const host = logicalHostName(urlHost);
  // 源站 host 按逻辑角色裁决，/sites 路径也进守卫。跨 host 回源会带着访客原来的 Host
  //（www → sites，以及没有签名密钥时的 fetch(url, req)）。这些请求若再次进入本函数，
  // 不能因为 Host 和 URL 不一致就 421，否则 www 和用户站会被自己的回源打下来。
  // 421 的豁免看逻辑角色。令牌校验仍用请求 URL 的主机，因为签名绑的是回源 URL。
  if (!isOriginGuardHost(host) && requestHostMismatchesUrl(req, u)) return originAuthorityMismatchResponse();

  // 0a) apex demox.site → 301 跳转到 www（保留 path+query，OAuth callback 的 code 不丢）
  // 映射打开时目标是物理 www（k2t-www），不是生产 www。
  if (host === APEX_HOST) {
    const target = 'https://' + physicalHostName(WWW_HOST) + u.pathname + u.search;
    return new Response(null, {
      status: 301,
      headers: { 'Location': target, 'Cache-Control': 'no-cache' }
    });
  }

  // 非法路径在任何查库、签名、回源之前拒绝。源站解析和子域名 rest 共用这一处。
  if (originPathUnsafe(u.pathname)) return originPathRejectResponse();

  // 源站 host 在任何 fetch(req) 放行之前裁决。子域名和自定义域不进这里。
  // 守卫角色看逻辑主机。令牌绑定的是回源 URL 的物理主机，所以校验传入 urlHost。
  if (isOriginGuardHost(host)) {
    return handleOriginGuard(req, event, ctx, u, urlHost);
  }

  // 只处理官方域名池的一层子域名；多层放行回源。
  // www.demox.site 不写死：label='www' 走下方通用路由表逻辑（DB websites.subdomain='www'）
  const parsedHost = parseOfficialHost(host);
  const customResolved = parsedHost ? null : await resolveCustomHost(host);
  if (!parsedHost && customResolved && customResolved.resolveState === 'error') {
    ctx.siteTraffic = true;
    ctx.resolveState = 'error';
    return siteUnavailableResponse('resolve=error; origin=none');
  }
  // 未绑定自定义域：解码失败 400；第一段以 sites 开头的路径不能原样回源。下一行必须保持 #49 之前的写法。
  if (!parsedHost && !(customResolved && customResolved.path)) {
    const passthroughKind = classifyPassthroughOriginPath(u.pathname);
    if (passthroughKind === 'reject') return originPathRejectResponse();
    if (passthroughKind === 'sites') return handleOriginGuard(req, event, ctx, u, urlHost);
    if (String(req.method || 'GET').toUpperCase() === 'OPTIONS') return originOptionsResponse();
  }
  if (!parsedHost && !(customResolved && customResolved.path)) return fetch(req);

  const label = parsedHost ? parsedHost.label : host;
  const domain = parsedHost ? parsedHost.domain : host;
  let rest = u.pathname.replace(/^\/+/, '');
  // 路由器拼到源站前缀上的 rest。含 %2f / %5c / %2e / %25、反斜杠、// 或点段时不查库、不签名、不回源。
  if (originPathUnsafe(u.pathname) || originPathUnsafe(rest) || originPathUnsafe('/' + rest)) {
    return originPathRejectResponse();
  }

  // 目录请求(根 / 或结尾 /)直接补 index.html，避免回源到「目录」让 COS 慢解析
  // index 文档(实测 www/ 比 www/index.html 慢 ~4s，且会触发回退二次 fetch)。
  if (rest === '' || rest.endsWith('/')) {
    rest += 'index.html';
  }

  // 查路由表：demox.site 下 label 可能是站点默认域名(websiteId 小写)或自定义前缀；
  // 其他官方域名只匹配用户显式绑定的自定义前缀。
  // 经 website-api resolve + 边缘 Cache。返回 { path, origin }(origin=该站点所属桶的回源域)。
  let { path, websiteId, origin, visibility, hideWatermark, seo, resolveState } = customResolved
    ? customResolved
    : await resolveSite(label, domain);
  const isWwwHost = domain === DEFAULT_OFFICIAL_DOMAIN && label === 'www';
  ctx.resolveState = resolveState || 'none';

  // 解析出错且没有任何可用兜底：可能是用户站点的 host 回 503（不是 404「站点未发布」）。
  // www 走下方硬编码兜底；平台入口 label（sites 等）保持原逻辑。
  if (!path && resolveState === 'error' && !isWwwHost && isPossibleSiteLabel(label, domain, !parsedHost)) {
    ctx.siteTraffic = true;
    return siteUnavailableResponse('resolve=error; origin=none');
  }

  // www 是主站基础设施(自托管 demox 本身)，path 固定。
  // resolveSite 偶发失败(SCF 抖动)时绝不放行回源桶根(桶根已清空会白屏)，
  // 用硬编码兜底。改绑主站时同时改 DB 与此常量。
  if (!path && domain === DEFAULT_OFFICIAL_DOMAIN && label === 'www') {
    path = WWW_FALLBACK_PATH;
    websiteId = 'EPX2UU43';
  }

  // Never pass an auth-completion POST through to a user-controlled origin.
  if (
    u.pathname === DEMOX_SITE_AUTH_COMPLETE_PATH &&
    (!path || visibility !== VISIBILITY_PRIVATE || (domain === DEFAULT_OFFICIAL_DOMAIN && label === 'www'))
  ) {
    return new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  if (path && !isWwwHost) {
    ctx.siteTraffic = true;
    const meta = {
      websiteId: websiteId,
      label: label,
      domain: domain,
      hideWatermark: hideWatermark,
      visibility: visibility,
      seo: seo,
      originState: 'none'
    };
    const resp = await serveResolvedSite(req, event, u, rest, path, origin, parsedHost, host, meta);
    return withRouteHeader(resp, 'resolve=' + ctx.resolveState + '; origin=' + meta.originState);
  }

  if (path) {
    if (!(domain === DEFAULT_OFFICIAL_DOMAIN && label === 'www') && visibility === VISIBILITY_DISABLED) {
      return disabledSitePage();
    }
    if (!(domain === DEFAULT_OFFICIAL_DOMAIN && label === 'www') && visibility === VISIBILITY_PRIVATE) {
      if (parsedHost && isOfficialDomain(domain)) return privateSiteReverifyResponse(req);
      if (u.pathname === DEMOX_SITE_AUTH_COMPLETE_PATH) {
        if (req.method !== 'POST') {
          return new Response('Method Not Allowed', {
            status: 405,
            headers: { Allow: 'POST', 'Cache-Control': 'no-store' }
          });
        }
        return completePrivateSiteLogin(req, label, domain);
      }
      const access = await checkPrivateSiteAccess(req, label, domain, parsedHost ? '' : host);
      if (!access.allowed) {
        if (!access.loginRequired) return accessDeniedPage(req);
        return isDocumentRequest(req) ? privateSiteLoginGate(req) : loginRequiredResponse();
      }
    }
    if (isSiteApiPath(u.pathname)) {
      return proxySiteFunction(req, websiteId, u);
    }
    // origin 为空(旧数据/默认桶)时 buildOriginUrl 回退到 sites.demox.site
    return rewriteOrigin(req, event, u, joinStoredOriginPath(path, rest), normalizeStoredOriginPath(path), origin, {
      websiteId: websiteId,
      label: label,
      domain: domain,
      hideWatermark: hideWatermark,
      visibility: visibility,
      seo: seo
    });
  }

  // 未知官方子域名（resolve 没有 path）。P0 2026-09-14：这里只处理「站点不存在」。
  // 已绑定站点即使回源 404 也绝不能落到这支。改品牌 404 前必读
  // docs/incidents/2026-09-14-p0-unknown-subdomain-404-outage.md
  // 解码失败 400。第一段以 sites 开头的路径不能原样回源到桶 1，交给源站守卫。
  const unknownKind = classifyPassthroughOriginPath(u.pathname);
  if (unknownKind === 'reject') return originPathRejectResponse();
  if (unknownKind === 'sites') return handleOriginGuard(req, event, ctx, u, urlHost);
  if (String(req.method || 'GET').toUpperCase() === 'OPTIONS') return originOptionsResponse();
  return fetch(req);
}

function stripAccessControlHeaders(headers) {
  const drop = [];
  headers.forEach(function (value, name) {
    if (String(name).toLowerCase().indexOf('access-control-') === 0) drop.push(name);
  });
  for (let i = 0; i < drop.length; i += 1) headers.delete(drop[i]);
}

function corsDeniedStatus(status) {
  return status === 400 || status === 403 || status === 404 || status === 405 || status === 503;
}

function corsAllowedObjectStatus(status) {
  return status === 304 || (status >= 200 && status < 300);
}

// 只有精确的布尔 true 才打开。env 上有 CORS_ENABLED 时以它为准，缺省才看硬编码。
// 字符串 'true' / '1' / 'yes'、数字 1、空串和其他写法都是关闭。
function originCorsEnabled() {
  try {
    if (typeof env !== 'undefined' && env && Object.prototype.hasOwnProperty.call(env, 'CORS_ENABLED')) {
      return env.CORS_ENABLED === true;
    }
  } catch (e) {}
  return CORS_ENABLED === true;
}

// 先清掉回源带上来的 Access-Control-*，再按开关决定是否写固定头。
// 错误状态什么都不写。不回显 Origin，不写 Allow-Credentials。
function applyOriginObjectCors(headers, status) {
  stripAccessControlHeaders(headers);
  if (!originCorsEnabled()) return;
  if (corsDeniedStatus(status) || !corsAllowedObjectStatus(status)) return;
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', ORIGIN_CORS_EXPOSE_HEADERS);
}

// 源站 host，以及本来要透传的 host，OPTIONS 都在边缘本地 204。不查库、不回源。
// 默认不附任何 Access-Control-*。完整模式只在 originCorsEnabled() 时附上固定头。
function originOptionsResponse() {
  const headers = {
    Allow: 'GET, HEAD',
    'Cache-Control': 'no-store',
    'x-demox-route': 'origin-guard=options'
  };
  if (originCorsEnabled()) {
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS';
    headers['Access-Control-Allow-Headers'] = ORIGIN_OPTIONS_CORS_ALLOW_HEADERS;
    headers['Access-Control-Max-Age'] = '86400';
  }
  return new Response(null, { status: 204, headers: headers });
}

// 已解析的用户站点（非 www）：与原 path 分支逻辑一致，回源走 rewriteOrigin 的加固路径。
async function serveResolvedSite(req, event, u, rest, path, origin, parsedHost, host, meta) {
  const label = meta.label;
  const domain = meta.domain;
  if (meta.visibility === VISIBILITY_DISABLED) {
    return disabledSitePage();
  }
  if (meta.visibility === VISIBILITY_PRIVATE) {
    if (parsedHost && isOfficialDomain(domain)) return privateSiteReverifyResponse(req);
    if (u.pathname === DEMOX_SITE_AUTH_COMPLETE_PATH) {
      if (req.method !== 'POST') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { Allow: 'POST', 'Cache-Control': 'no-store' }
        });
      }
      return completePrivateSiteLogin(req, label, domain);
    }
    const access = await checkPrivateSiteAccess(req, label, domain, parsedHost ? '' : host);
    if (!access.allowed) {
      if (!access.loginRequired) return accessDeniedPage(req);
      return isDocumentRequest(req) ? privateSiteLoginGate(req) : loginRequiredResponse();
    }
  }
  if (isSiteApiPath(u.pathname)) {
    return proxySiteFunction(req, meta.websiteId, u);
  }
  // origin 为空(旧数据/默认桶)时 buildOriginUrl 回退到 sites.demox.site
  return rewriteOrigin(req, event, u, joinStoredOriginPath(path, rest), normalizeStoredOriginPath(path), origin, meta);
}
