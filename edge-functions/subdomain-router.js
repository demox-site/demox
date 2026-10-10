/**
 * EdgeOne 边缘函数：subdomain-router
 * ---------------------------------------------------------------------------
 * 作用：处理官方域名池的访问。每个站点默认域名 = <websiteId 小写>.demox.site，
 * 另可选配一个自定义前缀。两者都查同一张路由表(websites 表):
 *   {label}.{officialDomain} → 调 website-api /resolve-subdomain 查 label+domain→path
 *   (demox.site 下 label 可匹配 websites.subdomain 或 LOWER(website_id))→ 回源 /{path}/{rest}
 * 结果走边缘 Cache(命中 60s、不存在 15s、出错不缓存，见 cachedResolve)。旧的 sites-{userId}-{fileId}-{dir} 格式已废弃。
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

// 2026-10-10 账号令牌 cookie 止血（step 1）：
// 旧前端把账号令牌写在 Domain=.demox.site 的 demox_access cookie 上，任何 *.demox.site 用户站点的
// 页面 JS 和用户函数都能拿到。这里保证：
//   1) 回源（sites.demox.site / site-*.demox.site / COS）和转发用户函数前，只删 Cookie 头里的 demox_access，
//      用户自己的其它 cookie 原样保留；删完为空就去掉整个 Cookie 头。
//   2) 官方域名下的请求带着旧 cookie 来，响应里顺手让浏览器把它过期掉（父域 + 本 host 两种）。
//   3) 官方域名（*.demox.site）私有站点不再认 cookie 里的账号令牌，先显示「需要重新验证」。
//      站点级短期票据是 step 2（单独 PR）。
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

// 2026-10-10 决定（Chief + 云架构）：静态站点 / 源站 / 透传路径恢复 #49 之前的转发方式，原样 fetch(req)，
// 不重建请求、不改头、不剥 cookie。三次发布都是在这条路径上出事：17:18 重建 Request → 503/404；
// 17:52 普通 init 带上入站 Host → COS 400；18:04 普通 init 原样 POST → COS 405，而原样传 req 时 EdgeOne 是用 GET 回源的。
// 只在 /api/* 函数转发（proxySiteFunction）剥离 demox_access。静态源站（COS）不执行代码，收到这个 cookie 也不会用。
// 凡是带 demox_access 的请求，响应上都追加两条过期 Set-Cookie（见 withExpiredAuthCookie），让浏览器删掉它。

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

// 用 new Response(resp.body, resp) 包一层（fetch 回来的响应头可能是只读的），再 append：
// 源站自己的 Set-Cookie 保留，不覆盖。包装失败（例如状态码不允许重建）就原样返回，绝不因此 500。
function withExpiredAuthCookie(resp, domain) {
  if (!resp || !domain) return resp;
  try {
    const out = new Response(resp.body, resp);
    const values = expireAuthCookieHeaders(domain);
    for (let i = 0; i < values.length; i += 1) out.headers.append('Set-Cookie', values[i]);
    return out;
  } catch (e) {
    return resp;
  }
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
  const host = originHost || 'sites.demox.site';
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
    normalized === '/console/settings' || normalized === '/console/admin'
  ) return true;
  if (/^\/console\/admin\/[^/]+$/.test(normalized)) return true;
  if (/^\/console\/projects\/[^/]+\/(deploy|sites|members|settings)$/.test(normalized)) return true;
  if (/^\/console\/projects\/[^/]+\/sites\/[^/]+\/analytics$/.test(normalized)) return true;
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
  return String((u && u.hostname) || '').toLowerCase() === WWW_HOST;
}

async function rewriteOrigin(req, event, u, originPath, sitePath, originHost, meta) {
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

async function rewriteOriginOnce(req, event, u, originPath, sitePath, originHost, meta, hardened) {
  const originFetch = hardened
    ? function (url, init) { return fetchSiteOrigin(url, init, meta); }
    : function (url, init) { return fetch(url, init); };
  const resp = await originFetch(buildOriginUrl(req, originPath, u.search, originHost), req);
  if (resp.status === 404 && sitePath && shouldFallbackToIndex(req, originPath)) {
    // The Demox main site has a finite client-route surface. Unknown document
    // paths must remain real 404s instead of becoming indexable soft 404s.
    if (u.hostname.toLowerCase() === WWW_HOST && !isWwwSpaRoute(u.pathname)) {
      return serveCustom404(req, event, u, sitePath, originHost, meta);
    }
    const idxResp = await originFetch(buildOriginUrl(req, `/${sitePath}/index.html`, '', originHost), { method: 'GET' });
    if (idxResp.ok) {
      // SPA 入口用 200 返回，浏览器交给前端路由渲染(等同站点独占桶根的 fallback 行为)
      return withDemoxBadge(req, event, new Response(idxResp.body, {
        status: 200,
        headers: applySiteCacheHeaders({ 'Content-Type': 'text/html; charset=utf-8' }, meta)
      }), meta);
    }
    // index.html 不存在 → 尝试站点自定义 404.html，再兜底 Demox 默认 404
    return serveCustom404(req, event, u, sitePath, originHost, meta);
  }
  return withDemoxBadge(req, event, resp, meta);
}

/**
 * 404 处理：优先返回站点自定义 404.html，不存在则返回 Demox 默认 404 页面。
 * 保持 HTTP 404 状态码（SEO 友好）；仅对页面导航请求生效。
 */
async function serveCustom404(req, event, u, sitePath, originHost, meta) {
  // 1) 尝试站点的 404.html
  if (sitePath) {
    try {
      const custom404 = await fetch(buildOriginUrl(req, `/${sitePath}/404.html`, '', originHost), { method: 'GET' });
      if (custom404.ok) {
        const html = await custom404.text();
        const headers = new Headers(custom404.headers);
        headers.set('Content-Type', 'text/html; charset=utf-8');
        applySiteCacheHeaders(headers, meta, 404);
        return new Response(html, { status: 404, headers });
      }
    } catch (e) {}
  }
  // 2) 兜底：Demox 默认 404 页面
  const html = getDefault404Html(meta, u);
  return new Response(html, {
    status: 404,
    headers: applySiteCacheHeaders({ 'Content-Type': 'text/html; charset=utf-8' }, meta, 404)
  });
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
  const host = new URL(req.url).hostname.toLowerCase();
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

  const headers = { Location: location, 'Cache-Control': 'no-store' };
  if (domain !== DEFAULT_OFFICIAL_DOMAIN) {
    headers['Set-Cookie'] = DEMOX_AUTH_COOKIE + '=' + encodeURIComponent(token) +
      '; Max-Age=' + DEMOX_SITE_AUTH_COOKIE_MAX_AGE +
      '; Path=/; HttpOnly; Secure; SameSite=Lax';
  }
  return new Response(null, { status: 303, headers: headers });
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
      loginRequired: !!(data && data.loginRequired)
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

async function lookupResolve(payload) {
  let result = { status: 'error', reason: 'no attempt' };
  const attempts = Math.max(1, RESOLVE_ATTEMPTS);
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await resolveSleep(RESOLVE_RETRY_DELAY_MS);
    result = await resolveOnceWithTimeout(payload, RESOLVE_TIMEOUT_MS);
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

function isResolveEntryFresh(entry) {
  const age = resolveEntryAgeMs(entry);
  const ttl = entry.status === 'found' ? RESOLVE_CACHE_TTL : RESOLVE_NEGATIVE_TTL;
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

async function writeResolveCache(cache, cacheKey, status, resolution) {
  if (!cache) return;
  // found / blocked 的物理保留期 = stale-if-error 窗口（新鲜期由 cachedAt 在代码里判断）；
  // not_found 只保留 RESOLVE_NEGATIVE_TTL。
  const maxAge = status === 'not_found' ? RESOLVE_NEGATIVE_TTL : RESOLVE_STALE_IF_ERROR_TTL;
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
async function cachedResolve(cacheKeyUrl, payload, logName, legacyKeyUrl) {
  const cacheKey = new Request(cacheKeyUrl);
  let cache = null;
  try { cache = caches.default; } catch (e) { cache = null; }

  const cached = await readResolveCache(cache, cacheKey);
  if (cached && isResolveEntryFresh(cached)) {
    return withResolveState(resolutionFromEntry(cached), 'hit');
  }

  const result = await lookupResolve(payload);
  if (result.status === 'found' || result.status === 'blocked') {
    await writeResolveCache(cache, cacheKey, result.status, result.resolution);
    return withResolveState(result.resolution, 'miss');
  }
  if (result.status === 'not_found') {
    await writeResolveCache(cache, cacheKey, 'not_found', null);
    return withResolveState(emptyResolution(), 'miss');
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

async function handle(req, event) {
  const ctx = { siteTraffic: false, resolveState: 'none' };
  const staleCookieDomain = hasAuthCookie(req.headers) ? officialDomainOfHost(new URL(req.url).hostname) : '';
  try {
    const resp = await handleRequest(req, event, ctx);
    return staleCookieDomain ? withExpiredAuthCookie(resp, staleCookieDomain) : resp;
  } catch (e) {
    // 已确认是用户站点流量（非 www）时，任何意外异常都映射成 503，
    // 绝不让 passThroughOnException 回源到桶根返回「站点未发布」。
    if (ctx.siteTraffic) {
      try { console.warn('[subdomain-router] unexpected error on site traffic', (e && e.message) || e); } catch (err) {}
      const unavailable = siteUnavailableResponse('resolve=' + ctx.resolveState + '; origin=error');
      return staleCookieDomain ? withExpiredAuthCookie(unavailable, staleCookieDomain) : unavailable;
    }
    throw e;
  }
}

async function handleRequest(req, event, ctx) {
  const u = new URL(req.url);
  const host = u.hostname.toLowerCase();

  // 0a) apex demox.site → 301 跳转到 www（保留 path+query，OAuth callback 的 code 不丢）
  if (host === APEX_HOST) {
    const target = 'https://' + WWW_HOST + u.pathname + u.search;
    return new Response(null, {
      status: 301,
      headers: { 'Location': target, 'Cache-Control': 'no-cache' }
    });
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
  if (!parsedHost && !(customResolved && customResolved.path)) return fetch(req);

  const label = parsedHost ? parsedHost.label : host;
  const domain = parsedHost ? parsedHost.domain : host;
  let rest = u.pathname.replace(/^\/+/, '');

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
    return rewriteOrigin(req, event, u, `/${path}/${rest}`, path, origin, {
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
  return fetch(req);
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
  return rewriteOrigin(req, event, u, `/${path}/${rest}`, path, origin, meta);
}
